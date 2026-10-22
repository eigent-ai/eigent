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
