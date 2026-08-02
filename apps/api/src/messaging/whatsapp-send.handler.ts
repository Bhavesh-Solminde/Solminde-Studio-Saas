import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import { OpHandler, type OpMeta, type OpResult } from '../sync/op-handler.js';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { MessagingService } from './messaging.service.js';

export const whatsappSendPayload = z.object({
  toPhone: z.string().min(6).max(20),
  template: z.enum(['booking_confirm', 'reminder_24h', 'bill_pdf', 'birthday']),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type WhatsappSendPayload = z.infer<typeof whatsappSendPayload>;

/**
 * A POS-triggered WhatsApp send — a bill PDF, a manual reminder. It rides the
 * same outbox as every other write, so the front desk can trigger it with the
 * network down and it fires on reconnect. The op's id is carried onto the
 * message so a replayed op does not send twice.
 */
@Injectable()
export class WhatsappSendHandler extends OpHandler<WhatsappSendPayload> {
  readonly type = 'whatsapp.send';
  readonly schema = whatsappSendPayload;
  readonly requiredFeatures: readonly FeatureKey[] = ['whatsapp_manual'];
  readonly requiredPermissions: readonly Permission[] = ['customer.view'];

  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async apply(
    tx: PrismaTx,
    ctx: TenantCtx,
    payload: WhatsappSendPayload,
    op: OpMeta,
  ): Promise<OpResult> {
    const result = await this.messaging.queue(tx, ctx, {
      toPhone: payload.toPhone,
      template: payload.template,
      payload: payload.payload,
      opId: op.opId,
    });
    return { ok: true, entity: 'message', id: result.id, status: result.status };
  }
}
