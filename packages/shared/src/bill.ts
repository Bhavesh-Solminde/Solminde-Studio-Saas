/**
 * Bill maths, shared verbatim by the POS and the API.
 *
 * This is the reason the file lives in `packages/shared` and not in either app:
 * the device computes the total it prints on the receipt, and the server
 * recomputes the same total when the bill syncs. If the two ever used different
 * code they could disagree, and a printed bill that disagrees with the ledger is
 * exactly the "money is wrong" failure the whole system is built to prevent.
 * One function, two callers, no drift.
 *
 * Every amount here is integer paise (see money.ts). Never a float.
 */

import { addPaise, paise, splitGst, type Paise, type TaxSplit } from './money.js';

export type BillLineType = 'service' | 'product' | 'package' | 'membership';

export interface BillLineInput {
  readonly type: BillLineType;
  /** Catalogue id (serviceId/productId/packageId). Absent for ad-hoc lines. */
  readonly refId?: string;
  /**
   * The service delivered, when this line redeems a package session — the
   * session ledger records which service was drawn down. On a plain service
   * line `refId` already is the service, so this is left unset there.
   */
  readonly serviceId?: string;
  readonly name: string;
  readonly quantity: number;
  /** Per-unit price in paise. */
  readonly unitPrice: number;
  /** Absolute discount on this line in paise (not a percentage). */
  readonly discount?: number;
  /** GST rate as a percentage, e.g. 18 for 18%. */
  readonly taxRate: number;
  readonly staffId?: string;
}

export interface ComputedLine extends BillLineInput {
  /** unitPrice * quantity, before discount. */
  readonly gross: Paise;
  /** gross - discount. The value GST is charged on. */
  readonly taxable: Paise;
  readonly tax: TaxSplit;
  /** taxable + tax. */
  readonly lineTotal: Paise;
}

export interface ComputedBill {
  readonly lines: readonly ComputedLine[];
  /** Sum of gross line values, before any discount. */
  readonly subtotal: Paise;
  readonly discount: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  /** cgst + sgst + igst. */
  readonly tax: Paise;
  /** subtotal - discount + tax. What the customer pays. */
  readonly total: Paise;
}

/**
 * Compute a bill from its lines.
 *
 * Tax is computed per line and then summed, not computed once on the bill
 * subtotal. Two lines can carry different GST rates (a service at 18%, a retail
 * product at 18% but conceivably a different slab), so a single bill-level rate
 * would be wrong the moment a bill mixes rates. Per-line-then-sum is the only
 * correct order.
 */
export function computeBill(lines: readonly BillLineInput[], interState = false): ComputedBill {
  const computed: ComputedLine[] = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Line quantity must be a positive integer: ${line.name}`);
    }
    const gross = paise(line.unitPrice * line.quantity);
    const discount = paise(line.discount ?? 0);
    if (discount > gross) {
      throw new Error(`Discount exceeds line value on ${line.name}`);
    }
    const taxable = paise(gross - discount);
    const tax = splitGst(taxable, line.taxRate, interState);
    return { ...line, gross, taxable, tax, lineTotal: tax.total };
  });

  const subtotal = addPaise(...computed.map((l) => l.gross));
  const discount = addPaise(...computed.map((l) => paise(l.discount ?? 0)));
  const cgst = addPaise(...computed.map((l) => l.tax.cgst));
  const sgst = addPaise(...computed.map((l) => l.tax.sgst));
  const igst = addPaise(...computed.map((l) => l.tax.igst));
  const tax = addPaise(cgst, sgst, igst);
  const total = addPaise(...computed.map((l) => l.lineTotal));

  return { lines: computed, subtotal, discount, cgst, sgst, igst, tax, total };
}

// ---------------------------------------------------------------- settlement

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'wallet' | 'link';

export interface PaymentInput {
  readonly method: PaymentMethod;
  /** Positive paise tendered by this method. */
  readonly amount: number;
  readonly reference?: string;
}

/**
 * What a bill's payments do to the customer's wallet.
 *
 * Three distinct effects, each a separate ledger reason so reports can tell
 * them apart:
 *
 *   - `redeem`  — the customer spent existing wallet balance (negative).
 *   - `advance` — the customer over-tendered; the surplus tops up the wallet
 *                 (positive). This is how a prepaid advance is captured.
 *   - `due`     — the customer under-paid; the shortfall is money they owe,
 *                 held as a negative wallet balance (negative).
 *
 * Modelling dues as negative wallet is deliberate: it keeps advances and dues
 * in one append-only ledger whose SUM is the customer's net position, and that
 * sum commutes across offline terminals like every other ledger in the system.
 */
export interface WalletEffect {
  readonly delta: number;
  readonly reason: 'redeem' | 'advance' | 'due';
}

export function walletEffectsForBill(
  total: number,
  payments: readonly PaymentInput[],
): readonly WalletEffect[] {
  const walletRedeemed = payments
    .filter((p) => p.method === 'wallet')
    .reduce((sum, p) => sum + p.amount, 0);
  const paidExternal = payments
    .filter((p) => p.method !== 'wallet')
    .reduce((sum, p) => sum + p.amount, 0);

  const net = paidExternal + walletRedeemed - total;

  const effects: WalletEffect[] = [];
  if (walletRedeemed > 0) effects.push({ delta: -walletRedeemed, reason: 'redeem' });
  if (net > 0) effects.push({ delta: net, reason: 'advance' });
  if (net < 0) effects.push({ delta: net, reason: 'due' });
  return effects;
}

// ------------------------------------------------------- invoice numbering

/**
 * Indian financial year for a date, formatted `YY-YY` (e.g. `26-27`).
 *
 * The FY runs April→March, so anything from January to March belongs to the
 * year that started the previous April. Getting this boundary wrong misfiles a
 * bill's series in Q4 and the client's CA notices at return time.
 */
export function financialYear(date: Date): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1; // month 3 = April
  const two = (y: number) => String(y % 100).padStart(2, '0');
  return `${two(startYear)}-${two(startYear + 1)}`;
}

/** How many numbers a terminal leases at a time. */
export const LEASE_BLOCK_SIZE = 300;

/**
 * Re-lease once this fraction of the block is consumed. Leaving headroom means
 * a terminal that goes offline mid-block still has numbers to print with.
 */
export const RELEASE_AT_FRACTION = 0.8;

/**
 * The final, human-readable invoice number, e.g. `POSH/26-27/A/0001`.
 *
 * Assembled the same way on the device (which stamps it onto the printed
 * receipt) and on the server (which stores it). GST permits multiple series per
 * place of business, which is what makes per-terminal blocks legal — each
 * terminal owns a disjoint range so two offline counters can never collide.
 */
export function formatInvoiceNo(
  series: string,
  fy: string,
  terminalCode: string,
  n: number,
): string {
  return `${series}/${fy}/${terminalCode}/${String(n).padStart(4, '0')}`;
}
