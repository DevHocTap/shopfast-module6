import { SetMetadata } from '@nestjs/common';
import { PolicyName } from './policies';

export const RATE_LIMIT_KEY = 'rateLimitPolicies';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

/** Adds stricter policies to an endpoint, checked before the global `default` policy. */
export const RateLimit = (...policies: Exclude<PolicyName, 'default'>[]) =>
  SetMetadata(RATE_LIMIT_KEY, policies);

/** For infrastructure endpoints polled by machines (health checks). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
