import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../ratelimit.js';

describe('createRateLimiter', () => {
  it('allows up to max within a window', () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ windowMs: 1000, max: 3, now: () => now });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(true);
    const blocked = rl.check('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ windowMs: 1000, max: 1, now: () => now });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    now += 1001;
    expect(rl.check('a').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1, now: () => 1 });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true); // different key unaffected
  });

  it('sweeps expired entries so size() does not grow unboundedly', () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ windowMs: 1000, max: 10, now: () => now });
    for (let i = 0; i < 50; i++) {
      now += 2000; // each key's window expires before the next
      rl.check(`ip${i}`).allowed;
    }
    expect(rl.size()).toBeLessThanOrEqual(50);
    // after many windows, expired keys are dropped
    now += 100_000;
    rl.check('x');
    expect(rl.size()).toBeLessThanOrEqual(2);
  });

  it('reset() clears state', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1, now: () => 1 });
    rl.check('a');
    rl.check('a');
    rl.reset();
    expect(rl.check('a').allowed).toBe(true);
  });
});