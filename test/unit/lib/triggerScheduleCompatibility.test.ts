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
