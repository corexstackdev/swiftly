import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import type { AuthenticatedUser } from '../common/decorators';

export interface JwtPayload {
  sub: string;
  /** Organization the token is scoped to; switching orgs mints a new token. */
  org: string;
  type: 'access' | 'refresh';
}

/** Prefers the httpOnly cookie; the bearer header is for API clients. */
function tokenFromCookie(req: FastifyRequest, name: string): string | null {
  const request = req as FastifyRequest & {
    cookies?: Record<string, string>;
    raw?: { headers?: { cookie?: string } };
  };
  const direct = request.cookies?.[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const header = request.headers?.cookie ?? request.raw?.headers?.cookie;
  if (typeof header !== 'string') return null;
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

const fromCookie = (req: FastifyRequest): string | null => tokenFromCookie(req, 'access_token');

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('SESSION_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Refresh token cannot be used for API access');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, isSuperAdmin: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');

    // Permissions are resolved per request rather than carried in the token, so
    // revoking a role takes effect immediately instead of at token expiry.
    const permissions = await this.access.resolvePermissions(user.id, payload.org);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      organizationId: payload.org,
      permissions,
    };
  }
}
