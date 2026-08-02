import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { ACCESS_TOKEN_TTL_MS } from './auth.service.js';

export interface AccessClaims {
  sub: string;
  tenantId: string;
  roleId: string | null;
  terminalId: string | null;
}

/**
 * Access tokens. Short-lived (15 min) and used only to authorise sync calls.
 *
 * "Roll our own auth" means not depending on a managed auth provider — it does
 * not mean implementing JWT signing by hand, so this wraps a reviewed library.
 */
@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set and at least 32 characters.');
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims): Promise<{ token: string; expiresAt: number }> {
    const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.secret);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      return {
        sub: String(payload.sub),
        tenantId: String(payload.tenantId),
        roleId: (payload.roleId as string | null) ?? null,
        terminalId: (payload.terminalId as string | null) ?? null,
      };
    } catch {
      throw new UnauthorizedException('Access token invalid or expired');
    }
  }
}
