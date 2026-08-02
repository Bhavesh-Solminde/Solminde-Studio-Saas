/**
 * The commission engine, shared by the POS (which snapshots per-line commission
 * at bill time) and the API (which recomputes it and rolls it up into a period
 * summary). Same maths on both sides, for the same reason the bill maths is
 * shared: a stylist's pay is money, and money must never be wrong.
 *
 * Two layers, deliberately separated:
 *
 *   - Per-line commission (flat / service-vs-retail split) is snapshotted onto
 *     the bill line at bill time, so a later change to the rule cannot rewrite
 *     what a stylist already earned.
 *   - Slab and target-bonus amounts depend on a whole period's revenue, which no
 *     single line can know, so they are derived at read time from the period
 *     total. This is the "commission is derived from bill lines at read time"
 *     rule in the spec's ledger model.
 *
 * All money is integer paise.
 */

import { percentOf, type Paise } from './money.js';
import type { BillLineType } from './bill.js';

export type CommissionKind = 'flat' | 'slab';

/** One revenue tier. `uptoPaise: null` is the open-ended top tier. */
export interface SlabTier {
  readonly uptoPaise: number | null;
  readonly rate: number;
}

export interface CommissionRule {
  readonly kind: CommissionKind;
  /** Percent of a service line's net value. */
  readonly serviceRate: number;
  /** Percent of a retail (product) line's net value. */
  readonly retailRate: number;
  /** Ascending tiers, used only when kind === 'slab'. */
  readonly slabs?: readonly SlabTier[];
  readonly targetBonus?: { readonly targetPaise: number; readonly bonusPaise: number };
}

/**
 * Commission earned on a single bill line, snapshotted at bill time.
 *
 * Only flat rules snapshot a per-line amount; a slab rule's rate is unknown
 * until the period's revenue is totalled, so its lines snapshot zero and are
 * settled entirely at read time in {@link periodCommission}. Commission is taken
 * on the net (ex-GST) line value — the salon does not pay commission on tax it
 * merely collects for the government.
 */
export function lineCommission(
  rule: CommissionRule,
  lineType: BillLineType,
  netPaise: Paise,
): Paise {
  if (rule.kind !== 'flat') return percentOf(netPaise, 0);
  const rate = lineType === 'product' ? rule.retailRate : lineType === 'service' ? rule.serviceRate : 0;
  return percentOf(netPaise, rate);
}

/** The slab rate for a given period revenue: the first tier it fits under. */
export function slabRate(slabs: readonly SlabTier[], revenuePaise: number): number {
  for (const tier of slabs) {
    if (tier.uptoPaise === null || revenuePaise <= tier.uptoPaise) return tier.rate;
  }
  return slabs.length > 0 ? slabs[slabs.length - 1]!.rate : 0;
}

export interface PeriodCommission {
  /** Commission before any target bonus, in paise. */
  readonly base: number;
  /** Target bonus, if the period revenue reached the target, in paise. */
  readonly bonus: number;
  readonly total: number;
}

/**
 * A stylist's commission for a period.
 *
 * For a flat rule the base is the sum of the per-line snapshots — authoritative
 * and immune to a mid-period rule change. For a slab rule the base is computed
 * here from total net revenue, because the slab rate is only knowable once the
 * period is totalled. Either way a target bonus is added when the stylist's net
 * revenue reaches the target.
 */
export function periodCommission(
  rule: CommissionRule,
  totals: { serviceNetPaise: number; retailNetPaise: number; snapshotSumPaise: number },
): PeriodCommission {
  const totalNet = totals.serviceNetPaise + totals.retailNetPaise;

  const base =
    rule.kind === 'flat'
      ? totals.snapshotSumPaise
      : percentOf(totalNet as Paise, slabRate(rule.slabs ?? [], totalNet));

  const bonus =
    rule.targetBonus && totalNet >= rule.targetBonus.targetPaise ? rule.targetBonus.bonusPaise : 0;

  return { base, bonus, total: base + bonus };
}
