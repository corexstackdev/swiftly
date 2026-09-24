import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService, type TokenPair } from './auth.service';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().uuid().optional(),
});
type LoginDto = z.infer<typeof loginSchema>;

const switchOrgSchema = z.object({ organizationId: z.string().uuid() });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(dto.email, dto.password, dto.organizationId);
    this.setAuthCookies(reply, result);
    const { accessToken: _a, refreshToken: _r, ...safe } = result;
    return safe;
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const tokens = await this.auth.refresh(cookies?.refresh_token ?? '');
    this.setAuthCookies(reply, tokens);
    return { ok: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie('access_token', { path: '/' });
    reply.clearCookie('refresh_token', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('switch-organization')
  async switchOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(switchOrgSchema)) dto: { organizationId: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const tokens = await this.auth.switchOrganization(user.id, dto.organizationId);
    this.setAuthCookies(reply, tokens);
    return { ok: true };
  }

  /**
   * Tokens live in httpOnly cookies so a cross-site script in a published app —
   * where tenants run their own JS — cannot read them.
   */
  private setAuthCookies(reply: FastifyReply, tokens: TokenPair): void {
    const secure = process.env.NODE_ENV === 'production';
    reply.setCookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    });
    reply.setCookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  }
}
