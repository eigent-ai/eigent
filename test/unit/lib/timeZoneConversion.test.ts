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

import { localTimeToUTC, utcTimeToLocal } from '@/lib/utils';
import { describe, expect, it } from 'vitest';

const calendarIndex = (year: number, month: number, day: number) =>
  Date.UTC(year, month, day) / 86400000;

describe('timezone calendar rollover', () => {
  it.each([
    new Date(2026, 9, 1, 12),
    new Date(2026, 0, 1, 12),
    new Date(2026, 11, 31, 12),
  ])('keeps local-to-UTC day offsets bounded at %s', (reference) => {
    for (const hour of [0, 9, 23]) {
      const date = new Date(reference);
      date.setHours(hour, 30, 0, 0);
      const expected =
        calendarIndex(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate()
        ) - calendarIndex(date.getFullYear(), date.getMonth(), date.getDate());
      expect(localTimeToUTC(hour, 30, reference)).toEqual({
        utcHour: date.getUTCHours(),
        utcMinute: date.getUTCMinutes(),
        dayOffset: expected,
      });
      expect(Math.abs(expected)).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    '2026-10-01T01:00:00Z',
    '2026-09-30T23:00:00Z',
    '2026-12-31T23:00:00Z',
    '2027-01-01T01:00:00Z',
  ])('keeps UTC-to-local day offsets bounded at %s', (timestamp) => {
    const reference = new Date(timestamp);
    const expected =
      calendarIndex(
        reference.getFullYear(),
        reference.getMonth(),
        reference.getDate()
      ) -
      calendarIndex(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate()
      );
    expect(
      utcTimeToLocal(
        reference.getUTCHours(),
        reference.getUTCMinutes(),
        reference
      )
    ).toEqual({
      localHour: reference.getHours(),
      localMinute: reference.getMinutes(),
      dayOffset: expected,
    });
    expect(Math.abs(expected)).toBeLessThanOrEqual(1);
  });
});
