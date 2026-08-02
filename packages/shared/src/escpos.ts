/**
 * ESC/POS receipt bytes, generated client-side.
 *
 * Why not `window.print()`? DESIGN + spec §5: the browser print dialog is the
 * single slowest thing in the billing flow, and thermal printers render HTML
 * unpredictably. We generate the exact command bytes here instead and push them
 * straight down Web Serial or Web Bluetooth. This module is pure — bytes in,
 * bytes out — so it is testable and identical across every printer transport.
 *
 * The command set used is the common ESC/POS subset every 58/80mm printer
 * implements. Anything fancier is a per-printer gamble the spec explicitly warns
 * against ("every printer model lies about its spec sheet").
 *
 * Money is printed as `Rs.` rather than the ₹ glyph: the rupee sign is not in
 * the CP437/CP850 code pages these printers default to, and would print as
 * garbage. Correct-but-plain beats pretty-but-wrong on a receipt.
 */

import { formatPaise } from './money.js';

/** One printed line item on the receipt. All amounts are integer paise. */
export interface ReceiptLine {
  readonly name: string;
  readonly quantity: number;
  /** Line total in paise. */
  readonly amount: number;
}

export interface ReceiptPayment {
  readonly method: string;
  readonly amount: number;
}

export interface Receipt {
  readonly salonName: string;
  readonly address?: string;
  readonly gstNumber?: string;
  readonly invoiceNo: string;
  readonly dateStr: string;
  readonly customerName?: string;
  readonly lines: readonly ReceiptLine[];
  readonly subtotal: number;
  readonly discount: number;
  readonly tax: number;
  readonly total: number;
  readonly payments: readonly ReceiptPayment[];
  readonly footer?: string;
}

// Column width in characters for an 80mm printer at Font A (48 cols is 80mm,
// 32 is 58mm). 42 is the safe middle that both render without wrapping.
const WIDTH = 42;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

class Builder {
  private readonly chunks: number[] = [];

  raw(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  /**
   * ASCII text. Characters outside 0x20–0x7e are dropped rather than
   * mojibake'd onto the paper — a thermal printer's default code page cannot
   * render them, so they would print as garbage. Encoding by char code keeps
   * this module free of any TextEncoder/DOM lib dependency, so it compiles the
   * same for the Node API and the browser POS.
   */
  text(value: string): this {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0x20 && code <= 0x7e) this.chunks.push(code);
    }
    return this;
  }

  line(value = ''): this {
    return this.text(value).raw(LF);
  }

  init(): this {
    return this.raw(ESC, 0x40); // ESC @ — reset to a known state
  }

  align(where: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, where === 'left' ? 0 : where === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! n — bit 4 doubles height, bit 0 doubles width. */
  size(double: boolean): this {
    return this.raw(GS, 0x21, double ? 0x11 : 0x00);
  }

  /** Feed a few lines and full-cut the paper. */
  cut(): this {
    return this.raw(LF, LF, LF, GS, 0x56, 0x00);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** Left-justify `left`, right-justify `right`, within WIDTH columns. */
function row(left: string, right: string): string {
  const gap = WIDTH - left.length - right.length;
  if (gap < 1) return `${left} ${right}`;
  return left + ' '.repeat(gap) + right;
}

function rule(): string {
  return '-'.repeat(WIDTH);
}

/**
 * Render a receipt to ESC/POS bytes. The HTML fallback path (for printers with
 * no Serial/Bluetooth) formats the same `Receipt` model separately in the POS.
 */
export function renderReceipt(receipt: Receipt): Uint8Array {
  const b = new Builder().init();

  b.align('center').bold(true).size(true).line(receipt.salonName).size(false);
  if (receipt.address) b.line(receipt.address);
  if (receipt.gstNumber) b.line(`GSTIN: ${receipt.gstNumber}`);
  b.bold(false).raw(LF);

  b.align('left');
  b.line(`Invoice: ${receipt.invoiceNo}`);
  b.line(`Date:    ${receipt.dateStr}`);
  if (receipt.customerName) b.line(`Customer: ${receipt.customerName}`);
  b.line(rule());

  for (const line of receipt.lines) {
    const label = line.quantity > 1 ? `${line.name} x${line.quantity}` : line.name;
    b.line(row(label.slice(0, WIDTH - 12), `Rs.${formatPaise(line.amount)}`));
  }

  b.line(rule());
  b.line(row('Subtotal', `Rs.${formatPaise(receipt.subtotal)}`));
  if (receipt.discount > 0) b.line(row('Discount', `-Rs.${formatPaise(receipt.discount)}`));
  b.line(row('GST', `Rs.${formatPaise(receipt.tax)}`));
  b.bold(true).line(row('TOTAL', `Rs.${formatPaise(receipt.total)}`)).bold(false);
  b.line(rule());

  for (const payment of receipt.payments) {
    b.line(row(payment.method.toUpperCase(), `Rs.${formatPaise(payment.amount)}`));
  }

  b.raw(LF).align('center').line(receipt.footer ?? 'Thank you! Visit again.');
  b.cut();

  return b.build();
}
