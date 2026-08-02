import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

export const dayClosePayload = z.object({
  id: z.uuid(),
  locationId: z.uuid().nullish(),
  /** Business date being closed, `YYYY-MM-DD` in the salon's local day. */
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Paise physically counted in the drawer at close. */
  countedCash: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
});

export type DayClosePayload = z.infer<typeof dayClosePayload>;

/**
 * Cash reconciliation for one terminal's day.
 *
 * Expected cash is derived, not stored: SUM of cash payments on that terminal's
 * final bills for the business date. Variance is the physical count minus that
 * expectation — a persistent non-zero variance is the signal the owner acts on
 * (skimming, a miskeyed bill, a forgotten expense). The counted figure is a
 * point-in-time snapshot, so it breaks no ledger rule.
 *
 * Expenses are deliberately out of scope here: the day-close in Stage 2
 * reconciles takings only. Cash expenses fold in when the expenses surface
 * lands, and the variance line is where they will show until then.
 */
@Injectable()
export class DayCloseHandler extends OpHandler<DayClosePayload> {
  readonly type = 'day.close';
  readonly schema = dayClosePayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['billing'];
  readonly requiredPermissions: readonly Permission[] = ['reports.financial'];

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: DayClosePayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const dayStart = new Date(`${payload.businessDate}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Cash takings for this terminal on this date, from final bills only. A
    // voided bill's payment must not count toward the drawer.
    const bills = await tx.bill.findMany({
      where: {
        terminalId: op.terminalId,
        status: 'final',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true },
    });
    const billIds = bills.map((b) => b.id);

    const cash =
      billIds.length === 0
        ? { _sum: { amount: null as number | null } }
        : await tx.payment.aggregate({
            _sum: { amount: true },
            where: { billId: { in: billIds }, method: 'cash' },
          });
    const expectedCash = cash._sum.amount ?? 0;
    const variance = payload.countedCash - expectedCash;

    // Upsert on (tenant, terminal, date): closing the same day twice replaces
    // the earlier count rather than colliding. Replay of the same op is already
    // deduped upstream by processed_ops.
    const record = await tx.dayClose.upsert({
      where: {
        tenantId_terminalId_businessDate: {
          tenantId: ctx.tenantId,
          terminalId: op.terminalId,
          businessDate: dayStart,
        },
      },
      create: {
        id: payload.id,
        tenantId: ctx.tenantId,
        locationId: payload.locationId ?? null,
        terminalId: op.terminalId,
        businessDate: dayStart,
        expectedCash,
        countedCash: payload.countedCash,
        variance,
        note: payload.note ?? null,
        closedBy: ctx.userId,
        opId: op.opId,
      },
      update: {
        expectedCash,
        countedCash: payload.countedCash,
        variance,
        note: payload.note ?? null,
        closedBy: ctx.userId,
        opId: op.opId,
      },
    });

    return { ok: true, entity: 'day_close', id: record.id, expectedCash, variance };
  }
}
