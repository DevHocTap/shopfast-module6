import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures, then lets a trial through after the cooldown', () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 10_000, () => now);

    breaker.failure();
    breaker.failure();
    expect(breaker.state).toBe('closed');
    breaker.failure();
    expect(breaker.state).toBe('open');
    expect(breaker.canRequest()).toBe(false);

    now = 10_000;
    expect(breaker.state).toBe('half-open');
    expect(breaker.canRequest()).toBe(true);
  });

  it('closes again on success and re-opens if the trial fails', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);

    breaker.failure();
    now = 1000;
    breaker.failure(); // trial failed
    expect(breaker.state).toBe('open');

    now = 2000;
    breaker.success();
    expect(breaker.state).toBe('closed');
  });
});
