import { ValueTransformer } from 'typeorm';

/**
 * Money is stored as BIGINT (VND). node-postgres returns BIGINT as a string to avoid precision loss;
 * VND amounts stay far below Number.MAX_SAFE_INTEGER (9e15), so a number is safe in the app.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
