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

import { confirmScheduleTimezone } from '@/lib/triggerScheduleCompatibility';
import type { Trigger } from '@/types';
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
it('restores UTC when a server fails to persist the timezone', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
  const update = vi.fn().mockResolvedValue({ id: 1 });
  await confirmScheduleTimezone(
    { id: 1, config: {} } as Trigger,
    {
      custom_cron_expression: '20 13 * * *',
      config: { timezone: 'Europe/London' },
    },
    update
  );
  expect(update).toHaveBeenCalledWith(1, {
    custom_cron_expression: '20 12 * * *',
    config: {},
  });
});
it('keeps the wall-time schedule after the server confirms its zone', async () => {
  const saved = { id: 1, config: { timezone: 'Europe/London' } } as Trigger;
  const update = vi.fn();
  expect(
    await confirmScheduleTimezone(
      saved,
      { custom_cron_expression: '20 13 * * *', config: saved.config },
      update
    )
  ).toBe(saved);
  expect(update).not.toHaveBeenCalled();
});
