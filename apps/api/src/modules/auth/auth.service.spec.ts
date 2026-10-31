import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Role } from '../../common/auth/role.enum';
import { LoginAttempts } from '../../common/rate-limit/login-attempts.service';
import { Env } from '../../infra/config/env.schema';
import { UserEntity } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshTokenEntity } from './refresh-token.entity';

const user: UserEntity = {
  id: 'u1',
  email: 'an@example.com',
  passwordHash: 'stored-hash',
  fullName: 'An',
  role: Role.CUSTOMER,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const users = {
    findByEmail: jest.fn(),
    getById: jest.fn().mockResolvedValue(user),
    create: jest.fn().mockResolvedValue(user),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
  const hasher = {
    hash: jest.fn().mockResolvedValue('new-hash'),
    verify: jest.fn(),
  };
  const tokens = {
    findOne: jest.fn(),
    insert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'JWT_ACCESS_TTL_SECONDS' ? 900 : 7)),
  };
  const attempts = {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    jwt as unknown as JwtService,
    hasher,
    tokens as unknown as Repository<RefreshTokenEntity>,
    attempts as unknown as LoginAttempts,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, users, jwt, hasher, tokens, attempts };
}

const storedToken = (overrides: Partial<RefreshTokenEntity> = {}): RefreshTokenEntity => ({
  id: 't1',
  userId: 'u1',
  tokenHash: 'h',
  familyId: 'fam-1',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('AuthService', () => {
  describe('register', () => {
    it('creates a customer with a hashed password and opens a session', async () => {
      const { service, users, hasher, tokens } = setup();
      users.findByEmail.mockResolvedValue(null);

      const session = await service.register({
        email: 'an@example.com',
        password: 'secret123',
        fullName: 'An',
      });

      expect(hasher.hash).toHaveBeenCalledWith('secret123');
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'new-hash' }),
      );
      expect(session).toMatchObject({
        accessToken: 'access.jwt',
        expiresIn: 900,
        user: { id: 'u1' },
      });
      // Only the hash of the refresh token is persisted.
      const inserted = tokens.insert.mock.calls[0][0] as { tokenHash: string };
      expect(inserted.tokenHash).not.toEqual(session.refreshToken);
      expect(inserted.tokenHash).toHaveLength(64);
    });

    it('refuses an email that is already registered', async () => {
      const { service, users } = setup();
      users.findByEmail.mockResolvedValue(user);

      await expect(
        service.register({ email: 'an@example.com', password: 'secret123', fullName: 'An' }),
      ).rejects.toMatchObject({ response: { code: 'EMAIL_TAKEN' } });
    });

    it('maps a concurrent duplicate (unique violation) to EMAIL_TAKEN', async () => {
      const { service, users } = setup();
      users.findByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue({ driverError: { code: '23505' } });

      await expect(
        service.register({ email: 'an@example.com', password: 'secret123', fullName: 'An' }),
      ).rejects.toMatchObject({ response: { code: 'EMAIL_TAKEN' } });
    });
  });

  describe('login', () => {
    it('returns a session for valid credentials', async () => {
      const { service, users, hasher } = setup();
      users.findByEmail.mockResolvedValue(user);
      hasher.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'an@example.com', password: 'ok' }),
      ).resolves.toMatchObject({
        user: { email: 'an@example.com' },
      });
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      const { service, users, hasher } = setup();
      hasher.verify.mockResolvedValue(false);

      users.findByEmail.mockResolvedValue(user);
      await expect(
        service.login({ email: 'an@example.com', password: 'bad' }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CREDENTIALS' },
      });

      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@example.com', password: 'bad' }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CREDENTIALS' },
      });
      // A hash comparison still ran for the unknown email (no timing shortcut).
      expect(hasher.verify).toHaveBeenCalledTimes(2);
    });
  });

  describe('login brute-force protection', () => {
    it('counts a failure against the target account and resets it on success', async () => {
      const { service, users, hasher, attempts } = setup();
      users.findByEmail.mockResolvedValue(user);

      hasher.verify.mockResolvedValueOnce(false);
      await expect(
        service.login({ email: 'an@example.com', password: 'bad' }),
      ).rejects.toBeDefined();
      expect(attempts.recordFailure).toHaveBeenCalledWith('an@example.com');

      hasher.verify.mockResolvedValueOnce(true);
      await service.login({ email: 'an@example.com', password: 'good' });
      expect(attempts.recordSuccess).toHaveBeenCalledWith('an@example.com');
    });

    it('refuses a locked account without checking the password', async () => {
      const { service, hasher, attempts } = setup();
      attempts.assertNotLocked.mockRejectedValue(new Error('locked'));

      await expect(service.login({ email: 'an@example.com', password: 'x' })).rejects.toThrow(
        'locked',
      );
      expect(hasher.verify).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates: revokes the presented token and issues a new one in the same family', async () => {
      const { service, tokens } = setup();
      tokens.findOne.mockResolvedValue(storedToken());

      const session = await service.refresh('raw-token');

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(tokens.insert).toHaveBeenCalledWith(expect.objectContaining({ familyId: 'fam-1' }));
      expect(session.accessToken).toBe('access.jwt');
    });

    it('revokes the whole family when a rotated token is reused (theft detection)', async () => {
      const { service, tokens } = setup();
      tokens.findOne.mockResolvedValue(storedToken({ revokedAt: new Date() }));

      await expect(service.refresh('stolen')).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.anything(),
      );
      expect(tokens.insert).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined, null],
      ['unknown', 'raw', null],
      ['expired', 'raw', storedToken({ expiresAt: new Date(Date.now() - 1) })],
    ])('rejects a %s token', async (_label, raw, found) => {
      const { service, tokens } = setup();
      tokens.findOne.mockResolvedValue(found);

      await expect(service.refresh(raw)).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
    });

    it('lets only one of two parallel refreshes with the same token win', async () => {
      const { service, tokens } = setup();
      tokens.findOne.mockResolvedValue(storedToken());
      tokens.update.mockResolvedValue({ affected: 0 });

      await expect(service.refresh('raw')).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
    });
  });

  describe('logout', () => {
    it('revokes the token family', async () => {
      const { service, tokens } = setup();
      tokens.findOne.mockResolvedValue(storedToken());

      await service.logout('raw');

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.anything(),
      );
    });

    it('is a no-op without a cookie', async () => {
      const { service, tokens } = setup();

      await service.logout(undefined);

      expect(tokens.findOne).not.toHaveBeenCalled();
    });
  });
});
