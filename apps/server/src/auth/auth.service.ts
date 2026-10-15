import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AccessService } from './access.service';
import type { JwtPayload } from './jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends TokenPair {
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
  };
  organization: { id: string; name: string; slug: string };
  /** Other orgs the user belongs to, for the org switcher. */
  availableOrganizations: { id: string; name: string; slug: string }[];
  permissions: string[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly access: AccessService,
  ) {}

  async login(email: string, password: string, organizationId?: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        memberships: { include: { organization: true } },
      },
    });

    // Same error and comparable timing whether the user exists or the password is
    // wrong, so login cannot be used to enumerate accounts.
    const stored = user?.passwordHash ?? 'scrypt$16384$8$1$00$00';
    const passwordOk = await this.crypto.verifyPassword(password, stored);

    if (!user || !user.isActive || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.memberships.length === 0) {
      throw new UnauthorizedException('User does not belong to any organization');
    }

    const membership =
      (organizationId
        ? user.memberships.find((m) => m.organizationId === organizationId)
        : undefined) ?? user.memberships[0]!;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, membership.organizationId);
    const permissions = await this.access.resolvePermissions(
      user.id,
      membership.organizationId,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
      },
      availableOrganizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
      })),
      permissions,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('SESSION_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) throw new UnauthorizedException('User is inactive');

    return this.issueTokens(payload.sub, payload.org);
  }

  /** Switching organizations re-scopes the token; permissions differ per org. */
  async switchOrganization(userId: string, organizationId: string): Promise<TokenPair> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    if (!membership) throw new UnauthorizedException('Not a member of that organization');
    return this.issueTokens(userId, organizationId);
  }

  private async issueTokens(userId: string, organizationId: string): Promise<TokenPair> {
    const secret = this.config.getOrThrow<string>('SESSION_SECRET');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, org: organizationId, type: 'access' } satisfies JwtPayload,
        { secret, expiresIn: `${this.config.get<number>('ACCESS_TOKEN_TTL', 900)}s` },
      ),
      this.jwt.signAsync(
        { sub: userId, org: organizationId, type: 'refresh' } satisfies JwtPayload,
        { secret, expiresIn: `${this.config.get<number>('REFRESH_TOKEN_TTL', 2_592_000)}s` },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
