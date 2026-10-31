import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Single source of truth for runtime configuration.
 * The process refuses to start when a variable is missing or malformed.
 * Secrets intentionally have no default value.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().default('dev'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: booleanString.default('false'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /** Password of the seeded demo accounts. Required only when running the seed script. */
  SEED_DEMO_PASSWORD: z.string().min(8).optional(),

  /** Public address of the web app, used for links inside emails. */
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  /** log: write emails to the log · smtp: Mailpit locally or any SMTP server · ses: AWS SES. */
  MAIL_TRANSPORT: z.enum(['log', 'smtp', 'ses']).default('log'),
  MAIL_FROM: z.string().default('ShopFast <no-reply@shopfast.local>'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanString.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  AWS_REGION: z.string().default('ap-southeast-2'),

  /** Background jobs (F05). */
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  PAYMENT_REMINDER_DELAY_MINUTES: z.coerce.number().int().positive().default(30),
  /** Share of calls the simulated warehouse partner fails, to demonstrate retries and dead letters. */
  PARTNER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.2),

  /** Off only for load tests that measure raw throughput. */
  RATE_LIMIT_ENABLED: booleanString.default('true'),

  WORKER_HEARTBEAT_FILE: z.string().default('/tmp/worker-heartbeat'),
});

export type Env = z.infer<typeof envSchema>;

/** Subset used by standalone database tools (migrations, seed): they need no app secrets. */
export const dbEnvSchema = envSchema.pick({
  DB_HOST: true,
  DB_PORT: true,
  DB_USER: true,
  DB_PASSWORD: true,
  DB_NAME: true,
  SEED_DEMO_PASSWORD: true,
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return parseOrThrow(envSchema, raw);
}

export function validateDbEnv(raw: Record<string, unknown>): DbEnv {
  return parseOrThrow(dbEnvSchema, raw);
}

function parseOrThrow<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: Record<string, unknown>,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
