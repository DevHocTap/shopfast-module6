import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { CookieOptions, Request, Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { Env } from '../../infra/config/env.schema';
import { UserProfile } from '../users/users.service';
import { AuthService, AuthSession } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'sf_refresh';

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: UserProfile;
}

/**
 * The refresh token never reaches JavaScript: it lives in an httpOnly, SameSite=Strict cookie
 * scoped to /api/auth. The short-lived access token is returned in the body and kept in memory.
 */
@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.respond(res, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.respond(res, await this.auth.login(dto));
  }

  /** 200 with a new session; 204 when the browser has no session cookie (a guest, not an error). */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse | undefined> {
    const token = readRefreshCookie(req);
    if (!token) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private respond(res: Response, session: AuthSession): SessionResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshExpiresAt,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secureCookie, sameSite: 'strict', path: '/api/auth' };
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}
