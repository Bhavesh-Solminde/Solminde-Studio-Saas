import { Injectable } from '@nestjs/common';
import { splitGst, type Paise } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';
import type { PrismaTx } from '../prisma.service.js';

// One salon workday, in minutes, for the utilisation denominator. Matches the
// availability window (10:00–20:00); both move together when a roster lands.
const WORKDAY_MIN = 600;

export interface StylistRevenue {
  staffId: string;
  displayName: string;
  services: number;
  retail: number;
  total: number;
}

export interface GstRateRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/**
 * Reporting is pure read-side aggregation over the ledgers and bills that
 * earlier stages already wrote — there is no new source of truth here. Every
 * figure is derived at query time, which is the same reason balances are
 * SUM(delta): the numbers cannot drift from what actually happened because they
 * are recomputed from it.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private finalBillIds(tx: PrismaTx, from: Date, to: Date) {
    return tx.bill
      .findMany({ where: { status: 'final', createdAt: { gte: from, lt: to } }, select: { id: true } })
      .then((bills) => bills.map((b) => b.id));
  }

  /** Revenue attributed to each stylist, split services vs retail, on net value. */
  async revenueByStylist(from: Date, to: Date): Promise<StylistRevenue[]> {
    return this.prisma.withTenant(async (tx) => {
      const billIds = await this.finalBillIds(tx, from, to);
      const [staff, lines] = await Promise.all([
        tx.staff.findMany({ select: { id: true, displayName: true } }),
        billIds.length
          ? tx.billLine.findMany({ where: { billId: { in: billIds }, staffId: { not: null } } })
          : Promise.resolve([]),
      ]);

      return staff
        .map((member) => {
          const own = lines.filter((l) => l.staffId === member.id);
          let services = 0;
          let retail = 0;
          for (const l of own) {
            const net = l.unitPrice * l.quantity - l.discount;
            if (l.type === 'product') retail += net;
            else if (l.type === 'service') services += net;
          }
          return { staffId: member.id, displayName: member.displayName, services, retail, total: services + retail };
        })
        .sort((a, b) => b.total - a.total);
    });
  }

  /** GST summary, rate-wise — the shape a GSTR-1 export needs. */
  async gstSummary(from: Date, to: Date): Promise<{ byRate: GstRateRow[]; totals: GstRateRow }> {
    return this.prisma.withTenant(async (tx) => {
      const billIds = await this.finalBillIds(tx, from, to);
      const lines = billIds.length
        ? await tx.billLine.findMany({ where: { billId: { in: billIds } } })
        : [];

      const byRateMap = new Map<number, GstRateRow>();
      for (const l of lines) {
        const rate = Number(l.taxRate);
        const net = (l.unitPrice * l.quantity - l.discount) as Paise;
        const split = splitGst(net, rate);
        const row = byRateMap.get(rate) ?? { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
        row.taxable += net;
        row.cgst += split.cgst;
        row.sgst += split.sgst;
        row.igst += split.igst;
        row.total += split.total;
        byRateMap.set(rate, row);
      }

      const byRate = [...byRateMap.values()].sort((a, b) => a.rate - b.rate);
      const totals = byRate.reduce(
        (acc, r) => ({
          rate: -1,
          taxable: acc.taxable + r.taxable,
          cgst: acc.cgst + r.cgst,
          sgst: acc.sgst + r.sgst,
          igst: acc.igst + r.igst,
          total: acc.total + r.total,
        }),
        { rate: -1, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
      );
      return { byRate, totals };
    });
  }

  /**
   * Lapsed clients — the win-back list. A customer who has billed before but not
   * in the last `days` is lapsed. "Last visit" is derived from their most recent
   * bill rather than a stored column, so it cannot fall out of sync with the
   * bills themselves.
   */
  async retention(days: number): Promise<{
    activeCount: number;
    lapsedCount: number;
    lapsed: { customerId: string; name: string; phone: string; lastVisit: string }[];
  }> {
    return this.prisma.withTenant(async (tx) => {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const bills = await tx.bill.findMany({
        where: { status: 'final', customerId: { not: null } },
        select: { customerId: true, createdAt: true },
      });

      const lastVisit = new Map<string, number>();
      for (const b of bills) {
        const id = b.customerId!;
        const t = b.createdAt.getTime();
        if (t > (lastVisit.get(id) ?? 0)) lastVisit.set(id, t);
      }

      const lapsedIds: string[] = [];
      let activeCount = 0;
      for (const [id, t] of lastVisit) {
        if (t < cutoff) lapsedIds.push(id);
        else activeCount++;
      }

      const customers = lapsedIds.length
        ? await tx.customer.findMany({
            where: { id: { in: lapsedIds } },
            select: { id: true, name: true, phone: true },
          })
        : [];

      const lapsed = customers
        .map((c) => ({
          customerId: c.id,
          name: c.name,
          phone: c.phone,
          lastVisit: new Date(lastVisit.get(c.id)!).toISOString(),
        }))
        .sort((a, b) => a.lastVisit.localeCompare(b.lastVisit));

      return { activeCount, lapsedCount: lapsed.length, lapsed };
    });
  }

  /** Chair utilisation: booked minutes over available minutes, per resource. */
  async chairUtilisation(from: Date, to: Date) {
    return this.prisma.withTenant(async (tx) => {
      const [resources, appts] = await Promise.all([
        tx.resource.findMany({ select: { id: true, name: true } }),
        tx.appointment.findMany({
          where: { status: 'booked', startAt: { lt: to }, endAt: { gt: from } },
          select: { resourceId: true, startAt: true, endAt: true },
        }),
      ]);

      const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
      const availableMinutes = days * WORKDAY_MIN;

      return resources.map((r) => {
        const bookedMinutes = appts
          .filter((a) => a.resourceId === r.id)
          .reduce((sum, a) => sum + (a.endAt.getTime() - a.startAt.getTime()) / 60000, 0);
        return {
          resourceId: r.id,
          name: r.name,
          bookedMinutes: Math.round(bookedMinutes),
          availableMinutes,
          pct: availableMinutes ? Math.round((bookedMinutes / availableMinutes) * 100) : 0,
        };
      });
    });
  }

  /**
   * Outstanding prepaid-package liability — unredeemed sessions the salon still
   * owes. This is the number the owner must see before disabling Packages: those
   * sessions are a customer-facing liability that hiding the module would make
   * silently disappear. Value is remaining sessions priced at the package's
   * per-session rate.
   */
  async packageLiability(): Promise<{ customers: number; sessions: number; valuePaise: number }> {
    return this.prisma.withTenant(async (tx) => {
      const [entries, packages, items] = await Promise.all([
        tx.sessionLedger.findMany({ select: { customerId: true, packageId: true, delta: true } }),
        tx.package.findMany({ select: { id: true, price: true } }),
        tx.packageItem.findMany({ select: { packageId: true, quantity: true } }),
      ]);

      const totalQty = new Map<string, number>();
      for (const it of items) totalQty.set(it.packageId, (totalQty.get(it.packageId) ?? 0) + it.quantity);
      const price = new Map(packages.map((p) => [p.id, p.price]));

      // Remaining sessions per (customer, package) = SUM(delta), counted only
      // when still positive.
      const remaining = new Map<string, number>();
      for (const e of entries) {
        const key = `${e.customerId}:${e.packageId}`;
        remaining.set(key, (remaining.get(key) ?? 0) + e.delta);
      }

      const customers = new Set<string>();
      let sessions = 0;
      let valuePaise = 0;
      for (const [key, rem] of remaining) {
        if (rem <= 0) continue;
        const [customerId, packageId] = key.split(':');
        customers.add(customerId!);
        sessions += rem;
        const perSession = (price.get(packageId!) ?? 0) / Math.max(1, totalQty.get(packageId!) ?? 1);
        valuePaise += Math.round(rem * perSession);
      }

      return { customers: customers.size, sessions, valuePaise };
    });
  }

  /** Retail attachment: share of bills that included a product line. */
  async retailAttachment(from: Date, to: Date) {
    return this.prisma.withTenant(async (tx) => {
      const billIds = await this.finalBillIds(tx, from, to);
      if (billIds.length === 0) return { totalBills: 0, billsWithRetail: 0, pct: 0 };
      const retailLines = await tx.billLine.findMany({
        where: { billId: { in: billIds }, type: 'product' },
        select: { billId: true },
      });
      const withRetail = new Set(retailLines.map((l) => l.billId));
      return {
        totalBills: billIds.length,
        billsWithRetail: withRetail.size,
        pct: Math.round((withRetail.size / billIds.length) * 100),
      };
    });
  }
}
