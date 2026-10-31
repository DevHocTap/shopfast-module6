import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PARAMS: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>> = { N: 16384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * scrypt from Node's standard library: memory-hard, salted, no native dependency.
 * Stored format: `scrypt$N$r$p$<salt base64>$<hash base64>` so parameters can be raised later.
 */
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await scryptAsync(password, salt, PARAMS);
    return [
      'scrypt',
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [algorithm, n, r, p, salt, hash] = stored.split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
