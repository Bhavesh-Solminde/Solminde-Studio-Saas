import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TokenService } from './auth/token.service.js';
import { tenantStorage } from './tenant-context.js';

/** Routes reachable without a tenant context. */
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/refresh']);

/**
 * Establishes tenant context for the request via AsyncLocalStorage.
 *
 * Not Nest's Scope.REQUEST: that re-instantiates the entire dependency chain
 * per request, which is slow and bites in subtle ways. ALS gives the same
 * context downstream with no plumbing and no per-request construction.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (PUBLIC_PATHS.has(req.path)) return next();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const claims = await this.tokens.verify(header.slice('Bearer '.length));

    tenantStorage.run(
      {
        tenantId: claims.tenantId,
        userId: claims.sub,
        role: claims.roleId ?? '',
        terminalId: claims.terminalId ?? undefined,
      },
      () => next(),
    );
  }
}
