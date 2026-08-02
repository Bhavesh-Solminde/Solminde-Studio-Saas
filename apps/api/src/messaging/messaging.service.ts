import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';
import { MESSAGING_PROVIDER, MessagingProvider } from './messaging.provider.js';

/**
 * Queues and dispatches outbound messages.
 *
 * Every message is written to the `messages` table first, with status 'queued',
 * so a send is durable before it is attempted — a POS-triggered message can be
 * queued while offline and picked up on sync, and a failed dispatch stays queued
 * for retry rather than vanishing. A dispatch failure never propagates into the
 * caller's transaction: a booking must still succeed even if the confirmation
 * message could not be sent right now.
 *
 * With the stub provider the dispatch is synchronous and instant. A live BSP
 * would do real network I/O, which should move to a post-commit worker so it
 * does not hold a database transaction open — noted for when credentials land.
 */
@Injectable()
export class MessagingService {
  private readonly log = new Logger(MessagingService.name);

  constructor(@Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider) {}

  async queue(
    tx: PrismaTx,
    ctx: TenantCtx,
    message: {
      toPhone: string;
      template: string;
      payload?: Record<string, unknown>;
      opId?: string;
    },
  ): Promise<{ id: string; status: 'sent' | 'queued' }> {
    const row = await tx.message.create({
      data: {
        tenantId: ctx.tenantId,
        channel: 'whatsapp',
        toPhone: message.toPhone,
        template: message.template,
        payload: (message.payload ?? null) as object,
        status: 'queued',
        opId: message.opId ?? null,
      },
    });

    try {
      const { providerRef } = await this.provider.dispatch({
        toPhone: message.toPhone,
        template: message.template,
        payload: message.payload,
      });
      await tx.message.update({
        where: { id: row.id },
        data: { status: 'sent', providerRef, sentAt: new Date() },
      });
      return { id: row.id, status: 'sent' };
    } catch (error) {
      // Leave it queued for a later retry; a send failure must not fail the
      // booking or bill that triggered it.
      this.log.warn(`Message ${row.id} left queued: ${String(error)}`);
      return { id: row.id, status: 'queued' };
    }
  }
}
