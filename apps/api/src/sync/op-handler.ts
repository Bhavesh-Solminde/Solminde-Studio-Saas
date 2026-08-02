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

  abstract apply(tx: PrismaTx, ctx: TenantCtx, payload: P): Promise<OpResult>;
}

/** Marks a provider as an OpHandler so the registry can discover it. */
export const OP_HANDLER = Symbol('OP_HANDLER');
