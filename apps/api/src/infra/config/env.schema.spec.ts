import { validateEnv } from './env.schema';

const base = {
  DB_HOST: 'localhost',
  DB_USER: 'shopfast',
  DB_PASSWORD: 'secret',
  DB_NAME: 'shopfast',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and coerces numbers and booleans', () => {
    const env = validateEnv({ ...base, PORT: '4000', SWAGGER_ENABLED: 'true' });

    expect(env.PORT).toBe(4000);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.DB_PORT).toBe(5432);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails fast and lists every missing variable', () => {
    expect(() => validateEnv({ REDIS_HOST: 'localhost' })).toThrow(
      /DB_HOST[\s\S]*DB_USER[\s\S]*DB_PASSWORD[\s\S]*DB_NAME/,
    );
  });
});
