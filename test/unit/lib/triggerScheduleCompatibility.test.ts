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
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalTimezone = process.env.TZ;

function inZone(timezone: string, now: string) {
  process.env.TZ = timezone;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
}

afterEach(() => {
  vi.useRealTimers();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function dropZone(
  cron: string,
  timezone: string,
  config: Record<string, unknown> = {}
) {
  const update = vi.fn().mockImplementation(async (id, data) => ({
    id,
    ...data,
  }));
  const undo = vi.fn().mockResolvedValue(undefined);
  const result = confirmScheduleTimezone(
    { id: 1, config: {} } as Trigger,
    { custom_cron_expression: cron, config: { ...config, timezone } },
    update,
    undo
  );
  return { result, update, undo };
}

describe('a server that drops the schedule zone', () => {
  it.each([['2026-07-01T00:00:00Z'], ['2026-10-20T00:00:00Z']])(
    'rewrites daily 13:20 London to the UTC cron on %s',
    async (now) => {
      inZone('Europe/London', now);
      const { result, update, undo } = dropZone('20 13 * * *', 'Europe/London');
      await result;
      expect(update).toHaveBeenCalledWith(1, {
        custom_cron_expression: '20 12 * * *',
        config: {},
      });
      expect(undo).not.toHaveBeenCalled();
    }
  );

  it('refuses monthly day 31 at 20:00 in Los Angeles instead of saving day 32', async () => {
    inZone('America/Los_Angeles', '2026-10-20T12:00:00Z');
    const { result, update, undo } = dropZone(
      '0 20 31 * *',
      'America/Los_Angeles'
    );
    await expect(result).rejects.toThrow(RangeError);
    expect(update).not.toHaveBeenCalled();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('builds monthly day 1 at 01:00 in Tokyo with the legacy converter', async () => {
    inZone('Asia/Tokyo', '2026-10-20T00:00:00Z');
    const { result, update } = dropZone('0 1 1 * *', 'Asia/Tokyo');
    await result;
    expect(update).toHaveBeenCalledWith(1, {
      custom_cron_expression: '0 16 L * *',
      config: {},
    });
  });

  it('moves the one-time date and expiration date to their UTC days', async () => {
    inZone('America/Los_Angeles', '2026-10-20T12:00:00Z');
    const once = dropZone('0 20 5 11 *', 'America/Los_Angeles', {
      date: '2026-11-05',
    });
    await once.result;
    expect(once.update).toHaveBeenCalledWith(1, {
      custom_cron_expression: '0 4 6 11 *',
      config: { date: '2026-11-06' },
    });

    const daily = dropZone('0 20 * * *', 'America/Los_Angeles', {
      expirationDate: '2026-12-01',
    });
    await daily.result;
    expect(daily.update).toHaveBeenCalledWith(1, {
      custom_cron_expression: '0 3 * * *',
      config: { expirationDate: '2026-12-02' },
    });
  });

  it('undoes the first save when the UTC rewrite is rejected', async () => {
    inZone('Europe/London', '2026-10-20T00:00:00Z');
    const update = vi.fn().mockRejectedValue(new Error('offline'));
    const undo = vi.fn().mockResolvedValue(undefined);
    await expect(
      confirmScheduleTimezone(
        { id: 1, config: {} } as Trigger,
        {
          custom_cron_expression: '20 13 * * *',
          config: { timezone: 'Europe/London' },
        },
        update,
        undo
      )
    ).rejects.toThrow('offline');
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('undoes the first save when the zone is not this machine zone', async () => {
    inZone('Europe/London', '2026-10-20T00:00:00Z');
    const { result, update, undo } = dropZone('0 9 * * *', 'Asia/Tokyo');
    await expect(result).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

it('keeps the wall-time schedule after the server confirms its zone', async () => {
  const saved = { id: 1, config: { timezone: 'Europe/London' } } as Trigger;
  const update = vi.fn();
  const undo = vi.fn();
  expect(
    await confirmScheduleTimezone(
      saved,
      { custom_cron_expression: '20 13 * * *', config: saved.config },
      update,
      undo
    )
  ).toBe(saved);
  expect(update).not.toHaveBeenCalled();
  expect(undo).not.toHaveBeenCalled();
});
