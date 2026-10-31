import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hasher.hash('S3cret-pass');

    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(hasher.verify('S3cret-pass', stored)).resolves.toBe(true);
    await expect(hasher.verify('s3cret-pass', stored)).resolves.toBe(false);
  });

  it('salts every hash: the same password never produces the same string', async () => {
    const [a, b] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);

    expect(a).not.toEqual(b);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    await expect(hasher.verify('x', 'plain-text-password')).resolves.toBe(false);
  });
});
