import { z } from 'zod';

/**
 * The outbox operation. Every user write becomes one of these BEFORE it touches
 * local state, and `opId` is the idempotency key the server dedupes on.
 *
 * Without server-side dedupe on opId, flaky 4G produces duplicate bills, and
 * duplicate bills lose the client.
 */
export const outboxOpSchema = z.object({
  /** UUID generated on the device. The idempotency key. */
  opId: z.uuid(),
  tenantId: z.uuid(),
  terminalId: z.uuid(),
  /** Monotonic per terminal. Preserves ordering when the outbox drains. */
  localSeq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
  status: z.enum(['pending', 'sent', 'acked', 'rejected']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});

export type OutboxOp = z.infer<typeof outboxOpSchema>;

export const syncPushRequestSchema = z.object({
  ops: z.array(outboxOpSchema).max(50),
});

export const syncPullRequestSchema = z.object({
  since: z.string().nullable(),
  tables: z.array(z.string()).min(1),
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

/** Backoff for the sync worker: 2s, 4s, 8s … capped at 5 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 5 * 60 * 1000);
}
