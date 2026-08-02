import { Injectable } from '@nestjs/common';
import { financialYear, LEASE_BLOCK_SIZE } from '@salon/shared';
import { PrismaService } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';

export interface LeaseGrant {
  series: string;
  financialYear: string;
  terminalCode: string;
  blockStart: number;
  blockEnd: number;
  nextNumber: number;
}

/**
 * Hands a terminal a disjoint block of invoice numbers to consume offline.
 *
 * The whole point of pre-leasing is that the number printed on a receipt is
 * final the instant it prints — it is never assigned later on sync. Two
 * terminals must therefore never be able to lease overlapping ranges, or two
 * customers walk out with the same invoice number and the client's GST filing
 * is corrupt.
 *
 * Correctness rests on one thing: the high-water mark for a (series, financial
 * year) is read and advanced atomically. A `pg_advisory_xact_lock` serialises
 * concurrent lease requests on that key, so `MAX(blockEnd) + 1` is always the
 * true next free number even when two terminals ask at the same moment. The
 * lock is transaction-scoped and releases on commit.
 */
@Injectable()
export class InvoiceLeaseService {
  constructor(private readonly prisma: PrismaService) {}

  async lease(params: {
    terminalId: string;
    series: string;
    terminalCode: string;
    now?: Date;
  }): Promise<LeaseGrant> {
    const { tenantId } = currentTenant();
    const fy = financialYear(params.now ?? new Date());

    return this.prisma.withTenant(async (tx) => {
      // Serialise on (tenant, series, fy). Any concurrent lease for the same
      // series waits here until this transaction commits.
      const lockKey = `${tenantId}:${params.series}:${fy}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

      const existing = await tx.invoiceLease.aggregate({
        _max: { blockEnd: true },
        where: { series: params.series, financialYear: fy },
      });
      const blockStart = (existing._max.blockEnd ?? 0) + 1;
      const blockEnd = blockStart + LEASE_BLOCK_SIZE - 1;

      await tx.invoiceLease.create({
        data: {
          tenantId,
          terminalId: params.terminalId,
          series: params.series,
          financialYear: fy,
          blockStart,
          blockEnd,
          nextNumber: blockStart,
        },
      });

      return {
        series: params.series,
        financialYear: fy,
        terminalCode: params.terminalCode,
        blockStart,
        blockEnd,
        nextNumber: blockStart,
      };
    });
  }
}
