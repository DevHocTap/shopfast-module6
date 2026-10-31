import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AccessTokenClaims } from '../../common/auth/auth-user';
import { AppError } from '../../common/errors/app-error';
import { Env } from '../../infra/config/env.schema';
import { isUniqueViolation } from '../../infra/database/transaction-runner';
import { UserEntity } from '../users/user.entity';
import { UserProfile, UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenEntity } from './refresh-token.entity';

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: UserProfile;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const invalidCredentials = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
const invalidSession = () =>
  new AppError(
    HttpStatus.UNAUTHORIZED,
    'INVALID_REFRESH_TOKEN',
    'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.',
  );

@Injectable()
export class AuthService {
  /** Compared against when the email does not exist, so both paths take the same time. */
  private dummyHash?: Promise<string>;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @InjectRepository(RefreshTokenEntity) private readonly tokens: Repository<RefreshTokenEntity>,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  async register(dto: RegisterDto): Promise<AuthSession> {
    if (await this.users.findByEmail(dto.email)) throw emailTaken();
    try {
      const user = await this.users.create({
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: await this.hasher.hash(dto.password),
      });
      return this.startSession(user);
    } catch (error) {
      // Two simultaneous registrations with the same email: the unique index decides.
      if (isUniqueViolation(error)) throw emailTaken();
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const user = await this.users.findByEmail(dto.email);
    this.dummyHash ??= this.hasher.hash(randomBytes(16).toString('hex'));
    const valid = await this.hasher.verify(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid) throw invalidCredentials();
    return this.startSession(user);
  }

  /** Rotation: every refresh consumes the presented token and issues a new one in the same family. */
  async refresh(rawToken: string | undefined): Promise<AuthSession> {
    if (!rawToken) throw invalidSession();
    const stored = await this.tokens.findOne({ where: { tokenHash: sha256(rawToken) } });
    if (!stored) throw invalidSession();

    if (stored.revokedAt) {
      // A rotated token came back: it was stolen or replayed. Kill every session of this login.
      await this.revokeFamily(stored.familyId);
      throw invalidSession();
    }
    if (stored.expiresAt.getTime() <= Date.now()) throw invalidSession();

    // Conditional update: two parallel refreshes with the same token cannot both succeed.
    const result = await this.tokens.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw invalidSession();

    const user = await this.users.getById(stored.userId);
    return this.issue(user, stored.familyId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.tokens.findOne({ where: { tokenHash: sha256(rawToken) } });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  private startSession(user: UserEntity): Promise<AuthSession> {
    return this.issue(user, randomUUID());
  }

  private async issue(user: UserEntity, familyId: string): Promise<AuthSession> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: this.accessTtlSeconds });

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlDays * DAY_MS);
    await this.tokens.insert({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken,
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshExpiresAt,
      user: UsersService.toProfile(user),
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.tokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emailTaken(): AppError {
  return new AppError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'Email này đã được đăng ký.');
}
