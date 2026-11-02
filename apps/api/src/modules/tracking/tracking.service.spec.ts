import { JwtService } from '@nestjs/jwt';
import { Role } from '../../common/auth/role.enum';
import { TrackingRepository } from './tracking.repository';
import { HandshakeRejected, TrackingService } from './tracking.service';

const ORDER_ID = '3f6c1a52-8a1d-4b8e-9f0a-1c2d3e4f5a6b';

function setup(verifyAsync = jest.fn(), owner: string | null = 'u1') {
  const repository = { ownerOf: jest.fn().mockResolvedValue(owner) };
  const service = new TrackingService(
    { verifyAsync } as unknown as JwtService,
    repository as unknown as TrackingRepository,
  );
  return { service, repository, verifyAsync };
}

describe('TrackingService.authenticate', () => {
  it('turns a valid access token into a session that ends when the token expires', async () => {
    const { service } = setup(
      jest.fn().mockResolvedValue({
        sub: 'u1',
        email: 'an@example.com',
        role: Role.CUSTOMER,
        exp: 1_800_000_000,
      }),
    );

    await expect(service.authenticate('token')).resolves.toEqual({
      user: { id: 'u1', email: 'an@example.com', role: Role.CUSTOMER },
      expiresAt: 1_800_000_000_000,
    });
  });

  it.each([undefined, '', 42, { token: 'x' }])('refuses a missing token (%p)', async (token) => {
    const { service, verifyAsync } = setup();

    await expect(service.authenticate(token)).rejects.toEqual(
      new HandshakeRejected('UNAUTHORIZED'),
    );
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('tells an expired token apart from a forged one', async () => {
    const expired = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    await expect(
      setup(jest.fn().mockRejectedValue(expired)).service.authenticate('old'),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(
      setup(jest.fn().mockRejectedValue(new Error('invalid signature'))).service.authenticate(
        'forged',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('TrackingService.parseOrderId', () => {
  const { service } = setup();

  it('accepts a UUID and normalises its case', () => {
    expect(service.parseOrderId({ orderId: ORDER_ID.toUpperCase() })).toBe(ORDER_ID);
  });

  it.each([null, 'x', {}, { orderId: 1 }, { orderId: "1' OR 1=1 --" }])(
    'rejects a malformed payload (%p)',
    (payload) => {
      expect(service.parseOrderId(payload)).toBeNull();
    },
  );
});

describe('TrackingService.canWatch', () => {
  const customer = { id: 'u1', email: 'an@example.com', role: Role.CUSTOMER };

  it('lets a customer follow their own order', async () => {
    await expect(setup(undefined, 'u1').service.canWatch(customer, ORDER_ID)).resolves.toBe(true);
  });

  it("refuses someone else's order and a missing one alike", async () => {
    await expect(setup(undefined, 'u2').service.canWatch(customer, ORDER_ID)).resolves.toBe(false);
    await expect(setup(undefined, null).service.canWatch(customer, ORDER_ID)).resolves.toBe(false);
  });

  it.each([Role.SUPPORT, Role.WAREHOUSE, Role.ADMIN])('lets %s follow any order', async (role) => {
    const { service, repository } = setup(undefined, 'u2');

    await expect(service.canWatch({ ...customer, role }, ORDER_ID)).resolves.toBe(true);
    expect(repository.ownerOf).not.toHaveBeenCalled();
  });
});
