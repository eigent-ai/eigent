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

import { parseServerTimestamp } from '@/lib/serverTimestamp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A viewer ahead of UTC makes local-time parsing visible: a timestamp read as
// local time lands eight hours earlier than the UTC instant it represents.
const originalTimezone = process.env.TZ;
const FOUR_AM_UTC = Date.UTC(2026, 9, 8, 4, 0, 0);

describe('parseServerTimestamp', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Singapore';
  });

  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it('runs in a timezone ahead of UTC', () => {
    expect(new Date(2026, 9, 8).getTimezoneOffset()).toBe(-480);
  });

  it.each([
    '2026-10-08T04:00:00',
    '2026-10-08T04:00',
    '2026-10-08 04:00:00',
    ' 2026-10-08T04:00:00 ',
  ])('reads %j without a timezone as UTC', (value) => {
    expect(parseServerTimestamp(value)).toBe(FOUR_AM_UTC);
  });

  it('keeps fractional seconds from Python isoformat output', () => {
    expect(parseServerTimestamp('2026-10-08T04:00:00.123456')).toBe(
      FOUR_AM_UTC + 123
    );
  });

  it.each([
    '2026-10-08T04:00:00Z',
    '2026-10-08T04:00:00.000Z',
    '2026-10-08T04:00:00+00:00',
    '2026-10-08T12:00:00+08:00',
    '2026-10-07T23:00:00-05:00',
  ])('keeps the explicit timezone in %j', (value) => {
    expect(parseServerTimestamp(value)).toBe(FOUR_AM_UTC);
  });

  it('keeps numbers as epoch milliseconds', () => {
    expect(parseServerTimestamp(FOUR_AM_UTC)).toBe(FOUR_AM_UTC);
    expect(parseServerTimestamp(0)).toBe(0);
  });

  it.each([null, undefined, '', '   ', 'not-a-date', Number.NaN, Infinity])(
    'returns NaN for %j',
    (value) => {
      expect(parseServerTimestamp(value)).toBeNaN();
    }
  );
});
