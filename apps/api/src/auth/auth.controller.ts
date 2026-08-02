import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service.js';
import { PermissionsService } from '../access/permissions.service.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import { AuthService, LOCAL_SESSION_TTL_MS, type LoginResult } from './auth.service.js';
import { TokenService } from './token.service.js';
import { tenantStorage } from '../tenant-context.js';

const loginBody = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(6),
  password: z.string().min(1),
  terminalId: z.uuid().optional(),
});

const refreshBody = z.object({ refreshToken: z.string().min(1) });

interface LoginRow {
  tenant_id: string;
  user_id: string;
  role_id: string | null;
  password_hash: string;
  status: string;
}

interface RefreshRow {
  tenant_id: string;
  user_id: string;
  role_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  status: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Post('login')
  async login(@Body() raw: unknown): Promise<LoginResult> {
    const body = loginBody.parse(raw);

    // The one lookup that cannot be tenant-scoped, because finding the tenant
    // is what it does. Runs through a SECURITY DEFINER function returning only
    // the five columns authentication needs — see prisma/sql/auth-functions.sql.
    const rows = await this.prisma.$queryRaw<LoginRow[]>`
      SELECT * FROM app_login_lookup(${body.tenantSlug}, ${body.phone})
    `;
    const found = rows[0];

    // Identical failure for unknown tenant, unknown user, inactive user and
    // wrong password. The response must not reveal which salons exist or who
    // works at them.
    const invalid = () => new UnauthorizedException('Invalid credentials');
    if (!found || found.status !== 'active') throw invalid();
    if (!(await this.auth.verifyPassword(body.password, found.password_hash))) throw invalid();

    const { tenant_id: tenantId, user_id: userId, role_id: roleId } = found;

    // Credentials are proven, so establish the tenant context now. Everything
    // downstream reads it from AsyncLocalStorage exactly as it would on a
    // normal request that came through TenantMiddleware.
    return tenantStorage.run(
      { tenantId, userId, role: roleId ?? '', terminalId: body.terminalId },
      () => this.issueSession({ tenantId, userId, roleId, terminalId: body.terminalId }),
    );
  }

  private async issueSession(params: {
    tenantId: string;
    userId: string;
    roleId: string | null;
    terminalId?: string;
  }): Promise<LoginResult> {
    const { tenantId, userId, roleId, terminalId } = params;

    const [permissions, features] = await Promise.all([
      this.permissions.resolve(userId),
      this.entitlements.resolve(tenantId),
    ]);

    const [access, refreshToken] = await Promise.all([
      this.tokens.sign({ sub: userId, tenantId, roleId, terminalId: terminalId ?? null }),
      this.auth.issueRefreshToken({ tenantId, userId, terminalId }),
    ]);

    const now = Date.now();
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      // The local session outlives the access token on purpose. The POS checks
      // this, never the API token, so a dead network cannot log the front desk
      // out in the middle of a bill.
      localSession: {
        userId,
        tenantId,
        roleId,
        terminalId: terminalId ?? null,
        permissions: [...permissions],
        features: [...features.entries()]
          .filter(([, state]) => state === 'enabled')
          .map(([key]) => key),
        issuedAt: now,
        expiresAt: now + LOCAL_SESSION_TTL_MS,
      },
    };
  }

  @Post('refresh')
  async refresh(@Body() raw: unknown) {
    const body = refreshBody.parse(raw);
    const tokenHash = this.auth.hashToken(body.refreshToken);

    const rows = await this.prisma.$queryRaw<RefreshRow[]>`
      SELECT * FROM app_refresh_lookup(${tokenHash})
    `;
    const found = rows[0];

    if (
      !found ||
      found.revoked_at !== null ||
      found.expires_at.getTime() < Date.now() ||
      found.status !== 'active'
    ) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const access = await this.tokens.sign({
      sub: found.user_id,
      tenantId: found.tenant_id,
      roleId: found.role_id,
      terminalId: null,
    });

    return { accessToken: access.token, accessExpiresAt: access.expiresAt };
  }
}
