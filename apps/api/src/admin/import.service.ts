import { Injectable } from '@nestjs/common';
import { parseCsv, rupeesToPaise } from '@salon/shared';
import { PrismaService, type PrismaTx } from '../prisma.service.js';
import { currentTenant } from '../tenant-context.js';

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** A row handler returns true when it wrote a row, false to skip it. */
type RowHandler = (tx: PrismaTx, tenantId: string, row: Record<string, string>) => Promise<boolean>;

/**
 * CSV import for onboarding — how a new salon's 800 existing customers, its
 * service menu and its product list get in without a developer touching the
 * database. Rows missing a required field are skipped, not rejected wholesale,
 * so one bad line in an 800-row file does not sink the import. Imports upsert on
 * the natural key (phone for customers) so re-running a corrected file does not
 * duplicate.
 *
 * Prices in the file are rupees as a human typed them; `rupeesToPaise` converts
 * to the integer paise everything downstream uses — the import is the boundary
 * where the money-is-integer-paise rule is enforced.
 */
@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse, then run `handle` per row, counting writes vs skips. One skeleton. */
  private async run(csvText: string, handle: RowHandler): Promise<ImportResult> {
    const { tenantId } = currentTenant();
    const rows = parseCsv(csvText);
    return this.prisma.withTenant(async (tx) => {
      let imported = 0;
      let skipped = 0;
      for (const row of rows) {
        if (await handle(tx, tenantId, row)) imported++;
        else skipped++;
      }
      return { imported, skipped };
    });
  }

  importCustomers(csvText: string): Promise<ImportResult> {
    return this.run(csvText, async (tx, tenantId, r) => {
      if (!r.name?.trim() || !r.phone?.trim()) return false;
      await tx.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: r.phone.trim() } },
        create: {
          tenantId,
          name: r.name.trim(),
          phone: r.phone.trim(),
          email: r.email?.trim() || null,
          notes: r.notes?.trim() || null,
        },
        update: { name: r.name.trim(), email: r.email?.trim() || null },
      });
      return true;
    });
  }

  importServices(csvText: string): Promise<ImportResult> {
    return this.run(csvText, async (tx, tenantId, r) => {
      if (!r.name?.trim() || !r.price?.trim()) return false;
      await tx.service.create({
        data: {
          tenantId,
          name: r.name.trim(),
          durationMin: Number(r.durationMin) || 30,
          price: rupeesToPaise(r.price.trim()),
          taxRate: Number(r.taxRate) || 18,
        },
      });
      return true;
    });
  }

  importProducts(csvText: string): Promise<ImportResult> {
    return this.run(csvText, async (tx, tenantId, r) => {
      if (!r.name?.trim() || !r.price?.trim()) return false;
      await tx.product.create({
        data: {
          tenantId,
          name: r.name.trim(),
          sku: r.sku?.trim() || null,
          cost: r.cost?.trim() ? rupeesToPaise(r.cost.trim()) : 0,
          price: rupeesToPaise(r.price.trim()),
          taxRate: Number(r.taxRate) || 18,
          reorderLevel: Number(r.reorderLevel) || 0,
        },
      });
      return true;
    });
  }
}
