import { test } from 'node:test';
import assert from 'node:assert/strict';

// Runs against the built output — the exact bytes the POS and API import — so a
// green test proves the shipped artefact, not just the source.
import {
  computeBill,
  walletEffectsForBill,
  financialYear,
  formatInvoiceNo,
  splitGst,
  paise,
  renderReceipt,
} from '../dist/index.js';

test('GST split is exact — cgst + sgst never loses a paisa on odd amounts', () => {
  // 2.5% of 101 paise is 2.525 -> rounds to 3; the halves must still sum to 3.
  const s = splitGst(paise(101), 5);
  assert.equal(s.cgst + s.sgst, s.igst === 0 ? s.total - s.taxable : s.igst);
  assert.equal(s.cgst + s.sgst + s.igst, s.total - s.taxable);
});

test('inter-state puts the whole rate in IGST, none in CGST/SGST', () => {
  const s = splitGst(paise(10000), 18, true);
  assert.equal(s.cgst, 0);
  assert.equal(s.sgst, 0);
  assert.equal(s.igst, 1800);
  assert.equal(s.total, 11800);
});

test('computeBill sums per-line tax, not tax on the subtotal', () => {
  const bill = computeBill([
    { type: 'service', name: 'Haircut', quantity: 1, unitPrice: 50000, taxRate: 18 },
    { type: 'product', name: 'Shampoo', quantity: 2, unitPrice: 30000, taxRate: 18 },
  ]);
  assert.equal(bill.subtotal, 110000); // 500 + 2*300 rupees
  assert.equal(bill.discount, 0);
  // 18% of 500 = 90, 18% of 600 = 108 -> 198 rupees tax
  assert.equal(bill.tax, 19800);
  assert.equal(bill.total, 129800);
  // The invariant that must always hold: total = subtotal - discount + tax.
  assert.equal(bill.total, bill.subtotal - bill.discount + bill.tax);
});

test('computeBill applies per-line discount before tax', () => {
  const bill = computeBill([
    { type: 'service', name: 'Colour', quantity: 1, unitPrice: 100000, discount: 20000, taxRate: 18 },
  ]);
  assert.equal(bill.subtotal, 100000);
  assert.equal(bill.discount, 20000);
  assert.equal(bill.tax, 14400); // 18% of 800 rupees
  assert.equal(bill.total, 94400);
});

test('computeBill rejects a discount larger than the line', () => {
  assert.throws(() =>
    computeBill([
      { type: 'service', name: 'X', quantity: 1, unitPrice: 100, discount: 200, taxRate: 18 },
    ]),
  );
});

test('wallet effects: pure redemption debits the wallet', () => {
  const effects = walletEffectsForBill(100000, [{ method: 'wallet', amount: 100000 }]);
  assert.deepEqual(effects, [{ delta: -100000, reason: 'redeem' }]);
});

test('wallet effects: over-tender becomes an advance credit', () => {
  // Pay 2000 for a 1000 bill in cash -> 1000 tops up the wallet.
  const effects = walletEffectsForBill(100000, [{ method: 'cash', amount: 200000 }]);
  assert.deepEqual(effects, [{ delta: 100000, reason: 'advance' }]);
});

test('wallet effects: partial payment becomes a due (negative balance)', () => {
  const effects = walletEffectsForBill(100000, [{ method: 'cash', amount: 60000 }]);
  assert.deepEqual(effects, [{ delta: -40000, reason: 'due' }]);
});

test('wallet effects: redeem + cash that fully settles nets the wallet by the redeemed amount only', () => {
  // Redeem 500 wallet, pay 500 cash on a 1000 bill: wallet drops by exactly 500.
  const effects = walletEffectsForBill(100000, [
    { method: 'wallet', amount: 50000 },
    { method: 'cash', amount: 50000 },
  ]);
  const netWallet = effects.reduce((s, e) => s + e.delta, 0);
  assert.equal(netWallet, -50000);
});

test('financial year respects the April boundary', () => {
  assert.equal(financialYear(new Date('2026-08-02')), '26-27');
  assert.equal(financialYear(new Date('2026-04-01')), '26-27');
  assert.equal(financialYear(new Date('2026-03-31')), '25-26'); // still last FY
  assert.equal(financialYear(new Date('2027-01-15')), '26-27');
});

test('invoice number is zero-padded and per-terminal', () => {
  assert.equal(formatInvoiceNo('POSH', '26-27', 'A', 1), 'POSH/26-27/A/0001');
  assert.equal(formatInvoiceNo('POSH', '26-27', 'B', 300), 'POSH/26-27/B/0300');
});

test('renderReceipt emits ESC/POS init and cut bytes', () => {
  const bytes = renderReceipt({
    salonName: 'Acme Salon',
    invoiceNo: 'POSH/26-27/A/0001',
    dateStr: '02 Aug 2026',
    lines: [{ name: 'Haircut', quantity: 1, amount: paise(50000) }],
    subtotal: paise(50000),
    discount: paise(0),
    tax: paise(9000),
    total: paise(59000),
    payments: [{ method: 'cash', amount: paise(59000) }],
  });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x1b); // ESC
  assert.equal(bytes[1], 0x40); // @ — the init sequence
  // Full-cut command GS V 0 appears near the end.
  assert.ok([...bytes].join(',').includes('29,86,0'));
});
