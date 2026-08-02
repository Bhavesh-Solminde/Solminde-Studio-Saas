import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequiresFeature, RequiresPermission } from '../access/guards.js';
import { PrismaService } from '../prisma.service.js';
import { LedgerService } from './ledger.service.js';
import { InvoiceLeaseService } from './invoice-lease.service.js';

const leaseBody = z.object({
  terminalId: z.uuid(),
  series: z.string().min(1).max(20),
  // Short per-terminal code baked into the printed number (POSH/26-27/A/0001).
  terminalCode: z.string().min(1).max(4),
});

/**
 * The online-only side of billing. The POS calls `lease` proactively while it
 * still has a network — leasing is the one billing action that legitimately
 * needs the server, because only the server can hand out a globally disjoint
 * range. Everything else (creating the bill, redeeming wallet, printing) is a
 * local Dexie write that syncs later.
 *
 * The read endpoints back the wallet-balance display and bill reprint. They are
 * server-authoritative; the POS still shows its local cache first and never
 * awaits these on the billing path.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly leases: InvoiceLeaseService,
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgerService,
  ) {}

  @Post('lease')
  @RequiresFeature('billing')
  @RequiresPermission('bill.create')
  async lease(@Body() raw: unknown) {
    const body = leaseBody.parse(raw);
    return this.leases.lease(body);
  }

  @Get('wallet/:customerId')
  @RequiresFeature('billing')
  @RequiresPermission('customer.view')
  async wallet(@Param('customerId') customerId: string) {
    const balance = await this.prisma.withTenant((tx) =>
      this.ledgers.walletBalance(tx, customerId),
    );
    return { customerId, balance };
  }

  @Get('stock/:productId')
  @RequiresFeature('billing')
  @RequiresPermission('inventory.view')
  async stock(@Param('productId') productId: string) {
    const onHand = await this.prisma.withTenant((tx) => this.ledgers.stockOnHand(tx, productId));
    return { productId, onHand };
  }

  @Get('bill/:id')
  @RequiresFeature('billing')
  @RequiresPermission('bill.reprint')
  async bill(@Param('id') id: string) {
    const bill = await this.prisma.withTenant(async (tx) => {
      const found = await tx.bill.findUnique({ where: { id } });
      if (!found) return null;
      const [lines, payments] = await Promise.all([
        tx.billLine.findMany({ where: { billId: id } }),
        tx.payment.findMany({ where: { billId: id } }),
      ]);
      return { ...found, lines, payments };
    });
    if (!bill) throw new NotFoundException(`Bill not found: ${id}`);
    return bill;
  }
}
