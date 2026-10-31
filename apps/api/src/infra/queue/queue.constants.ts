import { JobsOptions } from 'bullmq';

export const QUEUES = {
  email: 'email',
  invoice: 'invoice',
  inventorySync: 'inventory-sync',
  paymentReminder: 'payment-reminder',
  report: 'report',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUES);

const DAY_SECONDS = 24 * 60 * 60;
const keep = {
  removeOnComplete: { age: DAY_SECONDS, count: 1000 },
  removeOnFail: { age: 7 * DAY_SECONDS },
};

/**
 * Retry policy per kind of work (F05): exponential backoff, then the job lands in `failed_jobs`.
 * Email/partner calls fail transiently (network, provider limits) → more attempts.
 */
export const JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  [QUEUES.email]: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, ...keep },
  [QUEUES.invoice]: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, ...keep },
  // 8 attempts from 5 s: 5, 10, 20, 40, 80, 160, 320 s → about 10 minutes before giving up.
  [QUEUES.inventorySync]: { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, ...keep },
  [QUEUES.paymentReminder]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    ...keep,
  },
  [QUEUES.report]: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, ...keep },
};

/**
 * Deterministic job ids make enqueueing idempotent: adding a job whose id already exists is a no-op.
 * BullMQ does not allow ':' in custom ids.
 */
export const jobId = (...parts: (string | number)[]) => parts.join('-').replace(/:/g, '_');
