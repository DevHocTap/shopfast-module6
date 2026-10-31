export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * After `threshold` consecutive failures the breaker opens: callers skip Redis entirely for
 * `cooldownMs` instead of each paying a timeout. Then one trial call decides (half-open).
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): BreakerState {
    if (this.failures < this.threshold) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  canRequest(): boolean {
    return this.state !== 'open';
  }

  success(): void {
    this.failures = 0;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}
