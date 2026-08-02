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
    // originalUrl rather than req.path: Express strips the mount prefix from
    // req.path inside middleware, and a query string must not defeat the
    // match either. Getting this wrong locks everyone out of login.
    const path = (req.originalUrl || req.url).split('?')[0]?.replace(/\/+$/, '') ?? '';
    // The online-booking API is reached by walk-ins with no login. It resolves
    // the salon from its slug via a narrow SECURITY DEFINER function and scopes
    // itself, so it needs no bearer — but nothing else under the app does.
    if (PUBLIC_PATHS.has(path) || path.startsWith('/api/public/')) return next();

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
