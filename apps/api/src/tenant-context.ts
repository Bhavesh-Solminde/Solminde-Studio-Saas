import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tenant context via AsyncLocalStorage, NOT Nest's Scope.REQUEST.
 *
 * Request-scoped DI re-instantiates the whole dependency chain per request,
 * which is slow and bites in subtle ways. ALS gives the same context with no
 * plumbing and no per-request construction cost.
 */
export interface TenantCtx {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly terminalId?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantCtx>();

export function currentTenant(): TenantCtx {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    // Failing loudly here is deliberate. A query that runs without tenant
    // context is the bug class that lets Salon A see Salon B's customers.
    throw new Error('No tenant context. Did this run outside the tenant middleware?');
  }
  return ctx;
}
