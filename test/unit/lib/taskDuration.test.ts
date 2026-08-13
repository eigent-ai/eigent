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

import {
  resolveHistoricalRunElapsedMs,
  settleTaskElapsedMs,
} from '@/lib/taskDuration';
import { describe, expect, it } from 'vitest';

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
