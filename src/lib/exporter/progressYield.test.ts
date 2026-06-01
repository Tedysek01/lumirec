import { describe, expect, it } from 'vitest';
import { createProgressYieldScheduler } from './progressYield';

describe('createProgressYieldScheduler', () => {
  it('yields immediately for first progress paint, then throttles by interval', async () => {
    let now = 1_000;
    let yieldCount = 0;
    const scheduler = createProgressYieldScheduler({
      intervalMs: 100,
      now: () => now,
      yieldToEventLoop: async () => {
        yieldCount++;
      },
    });

    await scheduler.maybeYield();
    expect(yieldCount).toBe(1);

    now += 50;
    await scheduler.maybeYield();
    expect(yieldCount).toBe(1);

    now += 50;
    await scheduler.maybeYield();
    expect(yieldCount).toBe(2);
  });
});
