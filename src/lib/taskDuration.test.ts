import { describe, expect, it } from 'vitest';
import {
  resolveHistoricalRunElapsedMs,
  settleTaskElapsedMs,
} from './taskDuration';

describe('settleTaskElapsedMs', () => {
  it('adds the live attempt to previously settled elapsed time', () => {
    expect(
      settleTaskElapsedMs({ taskTime: 1_000, elapsed: 2_000 }, 8_500)
    ).toBe(9_500);
  });

  it('keeps an already settled duration unchanged', () => {
    expect(settleTaskElapsedMs({ taskTime: 0, elapsed: 12_345 }, 99_000)).toBe(
      12_345
    );
  });
});

describe('resolveHistoricalRunElapsedMs', () => {
  it('prefers the canonical attempt aggregate', () => {
    expect(
      resolveHistoricalRunElapsedMs({
        totalAttemptElapsedMs: 12_345,
        createdAt: 100,
        updatedAt: 200,
      })
    ).toBe(12_345);
  });

  it('uses RunJournal Unix-second boundaries for cloud-restored history', () => {
    expect(
      resolveHistoricalRunElapsedMs({
        createdAt: 1_786_101_992.187,
        updatedAt: 1_786_102_022.109,
      })
    ).toBeCloseTo(29_922, 0);
  });

  it('does not invent a duration without both boundaries', () => {
    expect(resolveHistoricalRunElapsedMs({ createdAt: 123 })).toBeUndefined();
  });
});
