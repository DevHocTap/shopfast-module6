/** What a policy can key on. `email` / `voucherCode` come from the request body when present. */
export interface RateLimitSubject {
  ip: string;
  userId?: string;
  email?: string;
  voucherCode?: string;
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  /** Counter identity, or null when the policy does not apply to this request. */
  key(subject: RateLimitSubject): string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Signed-in users are counted per account (fair behind shared NAT/Wi-Fi), guests per IP. */
const userOrIp = (s: RateLimitSubject) => (s.userId ? `user:${s.userId}` : `ip:${s.ip}`);

/**
 * F03 limits. `default` applies to every endpoint; the others are added with @RateLimit(...)
 * on sensitive endpoints, on top of the default.
 */
export const POLICIES = {
  default: { limit: 120, windowMs: MINUTE, key: userOrIp },

  /** Login attempts from one network address. Per-account guessing is handled by LoginAttempts. */
  login: { limit: 10, windowMs: MINUTE, key: (s) => `ip:${s.ip}` },
  register: { limit: 10, windowMs: HOUR, key: (s) => `ip:${s.ip}` },

  /** OTP costs money (email/SMS) and can be used to harass someone: limit per target AND per sender. */
  otpPerTarget: { limit: 1, windowMs: MINUTE, key: (s) => (s.email ? `email:${s.email}` : null) },
  otpPerTargetHourly: {
    limit: 5,
    windowMs: HOUR,
    key: (s) => (s.email ? `email:${s.email}` : null),
  },
  otpPerIp: { limit: 20, windowMs: HOUR, key: (s) => `ip:${s.ip}` },

  /** Flash-sale orders: only counted when a voucher is used, per account. */
  promoOrder: {
    limit: 3,
    windowMs: MINUTE,
    key: (s) => (s.voucherCode ? userOrIp(s) : null),
  },
} satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof POLICIES;
