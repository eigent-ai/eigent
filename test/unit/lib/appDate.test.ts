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

import { formatHubRelativeAgo } from '@/components/Home/utils';
import { formatAppDate } from '@/lib/appDate';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('app dates', () => {
  it('uses English app dates even when the OS default is Chinese', async () => {
    await i18next.init({ lng: 'en-US', resources: {} });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const native = Date.prototype.toLocaleDateString;
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locale,
      options
    ) {
      return native.call(this, locale ?? 'zh-CN', options);
    });

    const date = new Date('2026-10-19T12:00:00Z');
    expect(formatAppDate(date, { month: 'long' })).toBe('October');
    expect(formatHubRelativeAgo(date.toISOString(), () => '')).toContain('Oct');
  });
  it('reads a changed app language without caching the formatter', async () => {
    await i18next.init({ lng: 'en-US', resources: {} });
    expect(
      formatAppDate(new Date('2026-10-19T12:00:00Z'), { month: 'long' })
    ).toBe('October');
    await i18next.changeLanguage('fr');
    expect(
      formatAppDate(new Date('2026-10-19T12:00:00Z'), { month: 'long' })
    ).toBe('octobre');
  });
});
