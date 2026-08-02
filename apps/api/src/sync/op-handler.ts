import type { ZodType } from 'zod';
import type { FeatureKey, Permission } from '@salon/shared';
import type { PrismaTx } from '../prisma.service.js';
import type { TenantCtx } from '../tenant-context.js';

export interface OpResult {
  readonly ok: true;
  readonly entity?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

/**
 * The identity of the op being applied.
 *
 * A bill and every ledger entry it produces must carry the op's `opId` — it is
 * both the idempotency key and the audit link back to the originating device
 * action, and it is what a reversing entry points at when a bill is voided.
 * `terminalId` is likewise stamped onto ledger rows so a per-terminal cash
 * reconciliation can attribute takings. Both come from the outbox op, not from
 * the JWT, because the op may have been created on a terminal hours before it
 * finally syncs.
 */
export interface OpMeta {
  readonly opId: string;
  readonly terminalId: string;
}

/**
 * One syncable operation.
 *
 * Adding a new operation type is ONE new class and ZERO changes to the sync
 * engine. That is what lets two developers add operation types in parallel
 * without conflicting.
 */
export abstract class OpHandler<P = unknown> {
  /** e.g. 'customer.create', 'bill.create', 'stock.adjust' */
  abstract readonly type: string;
  abstract readonly schema: ZodType<P>;
  abstract readonly requiredFeatures: readonly FeatureKey[];
  abstract readonly requiredPermissions: readonly Permission[];

  abstract apply(tx: PrismaTx, ctx: TenantCtx, payload: P, op: OpMeta): Promise<OpResult>;
}

/** Marks a provider as an OpHandler so the registry can discover it. */
export const OP_HANDLER = Symbol('OP_HANDLER');
