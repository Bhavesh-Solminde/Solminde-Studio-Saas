import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma.service.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** 15 minutes. Authorises sync calls only. */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
/** 30 days. Used to silently mint new access tokens on reconnect. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * 24 hours. The LOCAL session — a different thing entirely.
 *
 * The front desk is billing at 7pm and the internet has been down three hours.
 * The access token expired ninety minutes ago. If the app logs them out
 * mid-bill, the client is lost. So the POS checks THIS, not the access token,
 * and API token expiry does not invalidate it.
 */
export const LOCAL_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface LoginResult {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  /** Handed to the POS to store in IndexedDB. Outlives the access token by design. */
  localSession: {
    userId: string;
    tenantId: string;
    roleId: string | null;
    terminalId: string | null;
    permissions: string[];
    features: string[];
    issuedAt: number;
    expiresAt: number;
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    // Constant-time: a length mismatch must not short-circuit either.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  /** Refresh tokens are stored hashed — a database leak must not yield usable tokens. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueRefreshToken(params: {
    tenantId: string;
    userId: string;
    terminalId?: string | null;
  }): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    // refresh_tokens is RLS-protected, so this insert must carry tenant scope
    // or Postgres rejects it with "new row violates row-level security policy".
    await this.prisma.withTenantId(params.tenantId, async (tx) => {
      await tx.refreshToken.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          terminalId: params.terminalId ?? null,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });
    });
    return token;
  }


  async revokeRefreshToken(tenantId: string, token: string): Promise<void> {
    await this.prisma.withTenantId(tenantId, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { tokenHash: this.hashToken(token) },
        data: { revokedAt: new Date() },
      });
    });
  }
}
