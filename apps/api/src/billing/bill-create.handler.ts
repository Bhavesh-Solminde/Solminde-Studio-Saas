import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  computeBill,
  lineCommission,
  walletEffectsForBill,
  type BillLineInput,
  type FeatureKey,
  type PaymentInput,
  type Permission,
} from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { LedgerService } from './ledger.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { AuditService } from '../audit/audit.service.js';

const billLine = z.object({
  type: z.enum(['service', 'product', 'package', 'membership']),
  refId: z.uuid().nullish(),
  // The service delivered when this line redeems a package session.
  serviceId: z.uuid().nullish(),
  name: z.string().min(1).max(160),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  discount: z.number().int().nonnegative().optional(),
  taxRate: z.number().min(0).max(100),
  staffId: z.uuid().nullish(),
});

const payment = z.object({
  method: z.enum(['cash', 'upi', 'card', 'wallet', 'link']),
  amount: z.number().int().positive(),
  reference: z.string().max(160).optional(),
});

export const billCreatePayload = z.object({
  // Device-generated id, so the local bill and the server bill are one record.
  id: z.uuid(),
  // Stamped on the device from its leased block and printed on the receipt, so
  // it is final the moment the customer walks out — never assigned on sync.
  invoiceNo: z.string().min(1).max(60),
  series: z.string().min(1).max(20),
  locationId: z.uuid().nullish(),
  customerId: z.uuid().nullish(),
  // Device clock in epoch ms — the receipt's timestamp and the business date a
  // day-close reconciles against. Server time is when it happened to sync,
  // which for an offline bill is the wrong moment entirely.
  createdAt: z.number().int(),
  interState: z.boolean().optional(),
  lines: z.array(billLine).min(1),
  payments: z.array(payment),
});

export type BillCreatePayload = z.infer<typeof billCreatePayload>;

@Injectable()
export class BillCreateHandler extends OpHandler<BillCreatePayload> {
  readonly type = 'bill.create';
  readonly schema = billCreatePayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['billing'];
  readonly requiredPermissions: readonly Permission[] = ['bill.create'];

  constructor(
    private readonly ledgers: LedgerService,
    private readonly commissions: CommissionService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: BillCreatePayload,
    op: OpMeta,
  ): Promise<OpResult> {
    // Recompute the totals server-side from the same shared function the device
    // used. The device's numbers are already printed, so this is not about
    // overriding them — it is about guaranteeing the ledger records exactly what
    // the shared maths produces, and rejecting a payload whose lines don't add
    // up to a payable bill. Because both sides run identical code, they agree.
    const computed = computeBill(payload.lines as BillLineInput[], payload.interState ?? false);

    const walletEffects = walletEffectsForBill(computed.total, payload.payments as PaymentInput[]);
    if (walletEffects.length > 0 && !payload.customerId) {
      // A redemption, an advance or a due all need someone to attach the
      // balance to. An anonymous walk-in cannot carry one.
      throw new Error('Wallet redemption, advance or due requires a customer on the bill');
    }

    const createdAt = new Date(payload.createdAt);

    await tx.bill.create({
      data: {
        id: payload.id,
        tenantId: ctx.tenantId,
        locationId: payload.locationId ?? null,
        terminalId: op.terminalId,
        invoiceNo: payload.invoiceNo,
        series: payload.series,
        customerId: payload.customerId ?? null,
        subtotal: computed.subtotal,
        discount: computed.discount,
        tax: computed.tax,
        total: computed.total,
        status: 'final',
        createdBy: ctx.userId,
        opId: op.opId,
        createdAt,
      },
    });

    // Snapshot each line's commission at bill time from the stylist's rule (or,
    // failing that, the service's). Snapshotting means a later rule change
    // cannot retroactively rewrite what a stylist already earned. Commission is
    // taken on the net (ex-GST) line value.
    let commissionTotal = 0;
    for (const line of computed.lines) {
      let commissionAmount = 0;
      if (line.staffId) {
        const rule = await this.commissions.resolveRule(tx, {
          staffId: line.staffId,
          serviceId: line.serviceId ?? line.refId,
          lineType: line.type,
        });
        if (rule) commissionAmount = lineCommission(rule, line.type, line.taxable);
      }
      commissionTotal += commissionAmount;

      await tx.billLine.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          billId: payload.id,
          type: line.type,
          refId: line.refId ?? null,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount ?? 0,
          taxRate: line.taxRate,
          staffId: line.staffId ?? null,
          commissionAmount,
        },
      });
    }

    if (payload.payments.length > 0) {
      await tx.payment.createMany({
        data: payload.payments.map((p) => ({
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          billId: payload.id,
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? null,
        })),
      });
    }

    // --- Stock: one debit per product line ------------------------------
    for (const line of computed.lines) {
      if (line.type !== 'product' || !line.refId) continue;
      await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          productId: line.refId,
          locationId: payload.locationId ?? null,
          delta: -line.quantity,
          reason: 'sale',
          billId: payload.id,
          terminalId: op.terminalId,
          opId: op.opId,
        },
      });
      const onHand = await this.ledgers.stockOnHand(tx, line.refId);
      await this.ledgers.flagIfNegative(tx, ctx.tenantId, {
        balance: onHand,
        type: 'negative_stock',
        ownerId: line.refId,
        billId: payload.id,
        terminalId: op.terminalId,
      });
    }

    // --- Packages: redeem one session per package line ------------------
    // A 'package' line draws a prepaid session down instead of charging money.
    // The session ledger is debited; if it goes negative or the package has
    // expired, that is surfaced as an exception rather than blocked, exactly
    // like an overdraft — the front desk is never stopped mid-bill.
    for (const line of computed.lines) {
      if (line.type !== 'package' || !line.refId || !payload.customerId) continue;
      const serviceId = line.serviceId ?? null;
      await tx.sessionLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          customerId: payload.customerId,
          packageId: line.refId,
          serviceId,
          delta: -line.quantity,
          billId: payload.id,
          terminalId: op.terminalId,
          opId: op.opId,
        },
      });

      const { _sum } = await tx.sessionLedger.aggregate({
        _sum: { delta: true },
        where: { customerId: payload.customerId, packageId: line.refId },
      });
      const remaining = _sum.delta ?? 0;

      const held = await tx.customerPackage.findFirst({
        where: { customerId: payload.customerId, packageId: line.refId },
        orderBy: { purchasedAt: 'desc' },
      });
      const expired = held?.expiresAt ? held.expiresAt.getTime() < createdAt.getTime() : false;

      if (remaining < 0 || expired) {
        await tx.syncException.create({
          data: {
            tenantId: ctx.tenantId,
            type: expired ? 'expired_package' : 'negative_sessions',
            detail: {
              customerId: payload.customerId,
              packageId: line.refId,
              billId: payload.id,
              remaining,
              expired,
            },
          },
        });
      }
    }

    // --- Wallet: redemption, advance and/or due -------------------------
    for (const effect of walletEffects) {
      await tx.walletLedger.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          customerId: payload.customerId!,
          delta: effect.delta,
          reason: effect.reason,
          billId: payload.id,
          terminalId: op.terminalId,
          opId: op.opId,
        },
      });
    }
    if (payload.customerId && walletEffects.some((e) => e.reason === 'redeem')) {
      // Only a redemption can push the wallet negative in a way that means an
      // overdraft; an advance is a credit and a due is expected to be negative.
      const balance = await this.ledgers.walletBalance(tx, payload.customerId);
      await this.ledgers.flagIfNegative(tx, ctx.tenantId, {
        balance,
        type: 'wallet_overdraft',
        ownerId: payload.customerId,
        billId: payload.id,
        terminalId: op.terminalId,
      });
    }

    await this.audit.record(tx, ctx, {
      action: 'bill.create',
      entity: 'bill',
      entityId: payload.id,
      after: {
        invoiceNo: payload.invoiceNo,
        total: computed.total,
        commission: commissionTotal,
        customerId: payload.customerId ?? null,
      },
    });

    return {
      ok: true,
      entity: 'bill',
      id: payload.id,
      invoiceNo: payload.invoiceNo,
      total: computed.total,
      commission: commissionTotal,
    };
  }
}
