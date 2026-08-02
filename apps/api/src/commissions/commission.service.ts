import { Injectable } from '@nestjs/common';
import { periodCommission, type CommissionRule } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';
import type { PrismaTx } from '../prisma.service.js';

export interface StaffCommission {
  staffId: string;
  displayName: string;
  serviceNet: number;
  retailNet: number;
  base: number;
  bonus: number;
  total: number;
}

/** Map a Prisma commission_rules row into the shared engine's rule shape. */
function toRule(row: {
  kind: string;
  serviceRate: unknown;
  retailRate: unknown;
  slabs: unknown;
  targetBonus: unknown;
}): CommissionRule {
  return {
    kind: row.kind === 'slab' ? 'slab' : 'flat',
    serviceRate: Number(row.serviceRate),
    retailRate: Number(row.retailRate),
    slabs: (row.slabs as CommissionRule['slabs']) ?? undefined,
    targetBonus: (row.targetBonus as CommissionRule['targetBonus']) ?? undefined,
  };
}

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The rule that applies to one bill line. A stylist's own rule takes
   * precedence; failing that, a service line falls back to the rule attached to
   * the service. Runs on the caller's transaction so it shares the bill's RLS
   * scope. Returns null when nothing applies — the line simply earns nothing.
   */
  async resolveRule(
    tx: PrismaTx,
    params: { staffId?: string | null; serviceId?: string | null; lineType: string },
  ): Promise<CommissionRule | null> {
    if (params.staffId) {
      const staff = await tx.staff.findUnique({ where: { id: params.staffId } });
      if (staff?.commissionRuleId) {
        const rule = await tx.commissionRule.findUnique({ where: { id: staff.commissionRuleId } });
        if (rule?.active) return toRule(rule);
      }
    }
    if (params.lineType === 'service' && params.serviceId) {
      const service = await tx.service.findUnique({ where: { id: params.serviceId } });
      if (service?.commissionRuleId) {
        const rule = await tx.commissionRule.findUnique({ where: { id: service.commissionRuleId } });
        if (rule?.active) return toRule(rule);
      }
    }
    return null;
  }

  /**
   * Each staff member's commission over a period, derived from bill lines.
   *
   * Base is the sum of per-line snapshots for a flat rule (so a later rule
   * change cannot rewrite settled pay) or computed from total net revenue for a
   * slab rule (whose rate is only knowable once the period is totalled). A
   * target bonus is layered on top. `staffFilter`, when present, is what enforces
   * `commission.view_own` — the caller passes the requester's own staff id.
   */
  async summary(from: Date, to: Date, staffFilter?: string[]): Promise<StaffCommission[]> {
    return this.prisma.withTenant(async (tx) => {
      const staff = await tx.staff.findMany({
        where: staffFilter ? { id: { in: staffFilter } } : {},
      });
      if (staff.length === 0) return [];

      const bills = await tx.bill.findMany({
        where: { status: 'final', createdAt: { gte: from, lt: to } },
        select: { id: true },
      });
      const billIds = bills.map((b) => b.id);
      const lines = billIds.length
        ? await tx.billLine.findMany({ where: { billId: { in: billIds }, staffId: { not: null } } })
        : [];

      const rules = new Map<string, CommissionRule>();
      const result: StaffCommission[] = [];

      for (const member of staff) {
        const own = lines.filter((l) => l.staffId === member.id);
        let serviceNet = 0;
        let retailNet = 0;
        let snapshotSum = 0;
        for (const line of own) {
          const net = line.unitPrice * line.quantity - line.discount;
          if (line.type === 'product') retailNet += net;
          else if (line.type === 'service') serviceNet += net;
          snapshotSum += line.commissionAmount;
        }

        let rule = member.commissionRuleId ? rules.get(member.commissionRuleId) : undefined;
        if (!rule && member.commissionRuleId) {
          const row = await tx.commissionRule.findUnique({ where: { id: member.commissionRuleId } });
          if (row) {
            rule = toRule(row);
            rules.set(member.commissionRuleId, rule);
          }
        }

        const comm = rule
          ? periodCommission(rule, {
              serviceNetPaise: serviceNet,
              retailNetPaise: retailNet,
              snapshotSumPaise: snapshotSum,
            })
          : { base: snapshotSum, bonus: 0, total: snapshotSum };

        result.push({
          staffId: member.id,
          displayName: member.displayName,
          serviceNet,
          retailNet,
          base: comm.base,
          bonus: comm.bonus,
          total: comm.total,
        });
      }

      return result;
    });
  }
}
