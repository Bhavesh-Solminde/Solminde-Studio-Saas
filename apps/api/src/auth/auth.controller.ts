import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service.js';
import { PermissionsService } from '../access/permissions.service.js';
import { EntitlementsService } from '../access/entitlements.service.js';
import { AuthService, LOCAL_SESSION_TTL_MS, type LoginResult } from './auth.service.js';
import { TokenService } from './token.service.js';

const loginBody = z.object({
  tenantSlug: z.string().min(1),
  phone: z.string().min(6),
  password: z.string().min(1),
  terminalId: z.uuid().optional(),
});

const refreshBody = z.object({ refreshToken: z.string().min(1) });

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

    // Login runs before tenant context exists, so it deliberately bypasses the
    // RLS-scoped wrapper. These two lookups are the only place that is true.
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: body.tenantSlug } });
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    const user = await this.prisma.user.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone: body.phone } },
    });
    // Same message and shape for unknown user and wrong password — the error
    // must not reveal which salons have which staff.
    if (!user || user.status !== 'active') throw new UnauthorizedException('Invalid credentials');
    if (!(await this.auth.verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const [access, refreshToken, permissions, features] = await Promise.all([
      this.tokens.sign({
        sub: user.id,
        tenantId: tenant.id,
        roleId: user.roleId,
        terminalId: body.terminalId ?? null,
      }),
      this.auth.issueRefreshToken({
        tenantId: tenant.id,
        userId: user.id,
        terminalId: body.terminalId,
      }),
      this.permissions.resolve(user.id),
      this.entitlements.resolve(tenant.id),
    ]);

    const now = Date.now();
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      // The local session outlives the access token on purpose. The POS checks
      // this, never the API token, so a dead network cannot log out the front
      // desk in the middle of a bill.
      localSession: {
        userId: user.id,
        tenantId: tenant.id,
        roleId: user.roleId,
        terminalId: body.terminalId ?? null,
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
    const { tenantId, userId } = await this.auth.consumeRefreshToken(body.refreshToken);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('User inactive');

    const access = await this.tokens.sign({
      sub: user.id,
      tenantId,
      roleId: user.roleId,
      terminalId: null,
    });

    return { accessToken: access.token, accessExpiresAt: access.expiresAt };
  }
}
