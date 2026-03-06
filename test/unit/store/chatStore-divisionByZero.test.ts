// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

/**
 * Test that task progress calculation guards against division by zero.
 *
 * This test verifies the logic pattern used in chatStore.ts where
 * taskProgress is calculated as (finishedTask / taskRunning.length) * 100.
 * When taskRunning is empty, the denominator is 0 and would produce NaN
 * or Infinity without the guard.
 */
import { describe, expect, it } from 'vitest';

function calculateTaskProgress(
  finishedTask: number | undefined,
  taskRunningLength: number | undefined
): number {
  const denominator = taskRunningLength ?? 0;
  const taskProgress =
    denominator === 0
      ? 0
      : ((finishedTask || 0) / denominator) * 100;
  return Number(taskProgress.toFixed(2));
}

describe('task progress division-by-zero guard', () => {
  it('returns 0 when taskRunning is empty (denominator = 0)', () => {
    expect(calculateTaskProgress(0, 0)).toBe(0);
  });

  it('returns 0 when taskRunning is undefined', () => {
    expect(calculateTaskProgress(5, undefined)).toBe(0);
  });

  it('calculates correct percentage for valid inputs', () => {
    expect(calculateTaskProgress(3, 10)).toBe(30);
  });

  it('returns 0 when finishedTask is undefined and denominator is 0', () => {
    expect(calculateTaskProgress(undefined, 0)).toBe(0);
  });

  it('handles 100% completion', () => {
    expect(calculateTaskProgress(5, 5)).toBe(100);
  });

  it('never returns NaN or Infinity', () => {
    const result = calculateTaskProgress(0, 0);
    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isNaN(result)).toBe(false);
  });
});
