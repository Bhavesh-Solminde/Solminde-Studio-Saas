/**
 * Money is ALWAYS integer paise. Never a float, never a Number holding rupees.
 *
 * Floating point cannot represent 0.1 exactly, so a bill built from float rupees
 * drifts by fractions that eventually show up as a ledger that does not balance.
 * The spec's first invariant is that money is never wrong; this type is where
 * that invariant is enforced.
 */
export type Paise = number & { readonly __brand: 'Paise' };

export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new Error(`Money must be integer paise, received ${value}`);
  }
  return value as Paise;
}

/** Parse a rupee string or number ("1234.50") into integer paise. */
export function rupeesToPaise(rupees: string | number): Paise {
  const asString = typeof rupees === 'number' ? rupees.toFixed(2) : rupees.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(asString);
  if (!match) {
    throw new Error(`Not a valid rupee amount: ${rupees}`);
  }
  const [, sign, whole, fraction = '0'] = match;
  const total = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return paise(sign === '-' ? -total : total);
}

/** Format integer paise for display. Not for arithmetic. */
export function formatPaise(value: Paise): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-IN')}.${fraction}`;
}

export function addPaise(...values: Paise[]): Paise {
  return paise(values.reduce<number>((sum, value) => sum + value, 0));
}

/**
 * Apply a percentage to a paise amount, rounding half away from zero.
 *
 * Banker's rounding is wrong here: a customer-facing invoice must round the way
 * a human with a calculator would, or the printed bill disagrees with the total.
 */
export function percentOf(value: Paise, percent: number): Paise {
  const exact = (value * percent) / 100;
  return paise(Math.sign(exact) * Math.round(Math.abs(exact)));
}

export interface TaxSplit {
  /** Taxable value before GST. */
  readonly taxable: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  readonly total: Paise;
}

/**
 * Split GST on an amount.
 *
 * Intra-state (the normal case for a salon serving walk-ins) splits the rate
 * evenly into CGST and SGST. Inter-state puts the whole rate into IGST.
 * The halves are computed so cgst + sgst always equals the full tax exactly —
 * computing each half independently loses a paisa on odd amounts.
 */
export function splitGst(taxable: Paise, ratePercent: number, interState = false): TaxSplit {
  const tax = percentOf(taxable, ratePercent);
  if (interState) {
    return {
      taxable,
      cgst: paise(0),
      sgst: paise(0),
      igst: tax,
      total: addPaise(taxable, tax),
    };
  }
  const cgst = paise(Math.trunc(tax / 2));
  const sgst = paise(tax - cgst);
  return { taxable, cgst, sgst, igst: paise(0), total: addPaise(taxable, tax) };
}
