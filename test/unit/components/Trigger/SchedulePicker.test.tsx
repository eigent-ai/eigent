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
  getNextScheduledTimes,
  parseScheduleNumber,
  SchedulePicker,
} from '@/components/Trigger/SchedulePicker';
import { localTimeToUTC } from '@/lib/utils';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const HOUR_ERROR = 'Enter a whole number from 0 to 23';
const MINUTE_ERROR = 'Enter a whole number from 0 to 59';
const DAY_ERROR = 'Enter a whole number from 1 to 31';
const PREVIEW_BLOCKED = 'Fix the highlighted fields to see scheduled times';

type User = ReturnType<typeof userEvent.setup>;

function renderPicker(value = '0 0 * * *') {
  const onChange = vi.fn();
  const onValidationChange = vi.fn();
  const onConfigChange = vi.fn();
  render(
    <SchedulePicker
      value={value}
      onChange={onChange}
      onValidationChange={onValidationChange}
      onConfigChange={onConfigChange}
    />
  );
  return { onChange, onValidationChange, onConfigChange };
}

function field(label: string): HTMLInputElement {
  const title = screen.getByText(label, { selector: 'span' });
  const input = title.parentElement?.parentElement?.querySelector('input');
  if (!input) throw new Error(`No input rendered for ${label}`);
  return input;
}

// Type into an InputSelect and commit with Enter, then let the field's
// delayed blur commit run so the next edit starts from a settled state.
async function commit(user: User, label: string, value: string) {
  const input = field(label);
  await user.clear(input);
  if (value) await user.type(input, value);
  await user.keyboard('{Enter}');
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
}

function dailyCron(hour: number, minute: number) {
  const { utcHour, utcMinute } = localTimeToUTC(hour, minute);
  return `${utcMinute} ${utcHour} * * *`;
}

function lastValidity(onValidationChange: ReturnType<typeof vi.fn>) {
  return onValidationChange.mock.lastCall?.[0];
}

describe('parseScheduleNumber', () => {
  it.each([
    ['0', 0],
    ['00', 0],
    ['07', 7],
    ['23', 23],
    [' 9 ', 9],
  ])('accepts hour %j', (value, expected) => {
    expect(parseScheduleNumber(value, { min: 0, max: 23 })).toBe(expected);
  });

  it.each(['24', '25', '-1', '1.5', '12abc', '+5', '1e1', '', '  '])(
    'rejects hour %j',
    (value) => {
      expect(parseScheduleNumber(value, { min: 0, max: 23 })).toBeNull();
    }
  );

  it('applies the minute and day-of-month ranges', () => {
    expect(parseScheduleNumber('59', { min: 0, max: 59 })).toBe(59);
    expect(parseScheduleNumber('60', { min: 0, max: 59 })).toBeNull();
    expect(parseScheduleNumber('31', { min: 1, max: 31 })).toBe(31);
    expect(parseScheduleNumber('0', { min: 1, max: 31 })).toBeNull();
    expect(parseScheduleNumber('32', { min: 1, max: 31 })).toBeNull();
  });
});

describe('getNextScheduledTimes', () => {
  // Local dates, as the preview shows them: [year, month (1-12), day, hour, minute].
  const local = (y: number, m: number, d: number, h = 9, min = 0) =>
    new Date(y, m - 1, d, h, min, 0, 0);
  const preview = (
    overrides: Partial<Parameters<typeof getNextScheduledTimes>[0]> & {
      now: Date;
    }
  ) =>
    getNextScheduledTimes({
      frequency: 'daily',
      hour: 9,
      minute: 0,
      weekdays: ['1'],
      dayOfMonth: 1,
      ...overrides,
    });

  it('keeps daily runs in order across the end of a month', () => {
    expect(preview({ now: local(2026, 10, 30, 10) })).toEqual([
      local(2026, 10, 31),
      local(2026, 11, 1),
      local(2026, 11, 2),
      local(2026, 11, 3),
      local(2026, 11, 4),
    ]);
  });

  it('keeps weekly runs in order across the end of a month', () => {
    // 2026-10-26 is a Monday.
    expect(
      preview({
        frequency: 'weekly',
        weekdays: ['1', '3'],
        now: local(2026, 10, 27, 10),
      })
    ).toEqual([
      local(2026, 10, 28),
      local(2026, 11, 2),
      local(2026, 11, 4),
      local(2026, 11, 9),
      local(2026, 11, 11),
    ]);
  });

  it('keeps monthly runs in order across the end of a year', () => {
    expect(
      preview({
        frequency: 'monthly',
        dayOfMonth: 15,
        now: local(2026, 11, 20, 10),
      })
    ).toEqual([
      local(2026, 12, 15),
      local(2027, 1, 15),
      local(2027, 2, 15),
      local(2027, 3, 15),
      local(2027, 4, 15),
    ]);
  });

  it('shows a monthly day only in months that have it', () => {
    expect(
      preview({
        frequency: 'monthly',
        dayOfMonth: 31,
        now: local(2027, 1, 15, 10),
      })
    ).toEqual([
      local(2027, 1, 31),
      local(2027, 3, 31),
      local(2027, 5, 31),
      local(2027, 7, 31),
      local(2027, 8, 31),
    ]);
  });

  it('includes today when its time is still ahead', () => {
    expect(
      preview({
        frequency: 'monthly',
        dayOfMonth: 30,
        now: local(2026, 10, 30, 8),
      })[0]
    ).toEqual(local(2026, 10, 30));
    expect(preview({ now: local(2026, 10, 30, 8) })[0]).toEqual(
      local(2026, 10, 30)
    );
  });

  it('shows a one-time run only while it is in the future', () => {
    expect(
      preview({
        frequency: 'one-time',
        oneTimeDate: local(2026, 11, 1, 0),
        now: local(2026, 10, 30, 10),
      })
    ).toEqual([local(2026, 11, 1)]);
    expect(
      preview({
        frequency: 'one-time',
        oneTimeDate: local(2026, 10, 1, 0),
        now: local(2026, 10, 30, 10),
      })
    ).toEqual([]);
  });
});

describe('SchedulePicker time validation', () => {
  it('rejects 25:54 on a daily schedule instead of rolling it over to 01:54', async () => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    const callsBeforeEdit = onChange.mock.calls.length;

    await commit(user, 'Hour', '25');
    await commit(user, 'Minute', '54');

    expect(lastValidity(onValidationChange)).toBe(false);
    // No cron is generated from the invalid hour.
    expect(onChange).not.toHaveBeenCalledWith(dailyCron(1, 54));
    expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();

    await user.click(screen.getByText('Preview Scheduled Times'));
    expect(screen.queryByText(/1:54/)).not.toBeInTheDocument();
    expect(screen.getByText(PREVIEW_BLOCKED)).toBeInTheDocument();

    await commit(user, 'Hour', '23');

    expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(PREVIEW_BLOCKED)).not.toBeInTheDocument();
    expect(screen.getAllByText(/11:54 PM/).length).toBeGreaterThan(0);
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0]).toBe(dailyCron(23, 54));
  });

  it.each([
    ['Hour', '24', HOUR_ERROR],
    ['Hour', '-1', HOUR_ERROR],
    ['Hour', '1.5', HOUR_ERROR],
    ['Hour', '12abc', HOUR_ERROR],
    ['Minute', '60', MINUTE_ERROR],
    ['Minute', '-5', MINUTE_ERROR],
    ['Minute', '7.5', MINUTE_ERROR],
    ['Minute', '12abc', MINUTE_ERROR],
  ])('shows an inline error for %s %j', async (label, value, message) => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    const callsBeforeEdit = onChange.mock.calls.length;

    await commit(user, label, value);

    expect(lastValidity(onValidationChange)).toBe(false);
    expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('highlights a cleared hour so the preview message points at it', async () => {
    const user = userEvent.setup();
    const { onValidationChange } = renderPicker();

    await commit(user, 'Hour', '');

    expect(lastValidity(onValidationChange)).toBe(false);
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
    await user.click(screen.getByText('Preview Scheduled Times'));
    expect(screen.getByText(PREVIEW_BLOCKED)).toBeInTheDocument();
  });

  it.each(['One Time', 'Weekly', 'Monthly'])(
    'validates the shared time fields on the %s tab',
    async (tab) => {
      const user = userEvent.setup();
      const { onChange, onValidationChange } = renderPicker();
      await user.click(screen.getByRole('tab', { name: tab }));
      const callsBeforeEdit = onChange.mock.calls.length;

      await commit(user, 'Hour', '25');
      await commit(user, 'Minute', '60');

      expect(lastValidity(onValidationChange)).toBe(false);
      expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
      expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
      expect(screen.getByText(MINUTE_ERROR)).toBeInTheDocument();

      await commit(user, 'Hour', '08');
      await commit(user, 'Minute', '05');

      expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
      expect(screen.queryByText(MINUTE_ERROR)).not.toBeInTheDocument();
      expect(lastValidity(onValidationChange)).toBe(true);
      const { utcHour, utcMinute } = localTimeToUTC(8, 5);
      expect(onChange.mock.lastCall?.[0]).toMatch(
        new RegExp(`^${utcMinute} ${utcHour} `)
      );
    }
  );

  it('does not crash when a one-time hour is not a number', async () => {
    const user = userEvent.setup();
    const { onValidationChange } = renderPicker();
    await user.click(screen.getByRole('tab', { name: 'One Time' }));

    await commit(user, 'Hour', 'abc');

    expect(lastValidity(onValidationChange)).toBe(false);
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
  });

  it.each(['0', '32', '1.5'])('rejects day of month %j', async (value) => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    await user.click(screen.getByRole('tab', { name: 'Monthly' }));
    const callsBeforeEdit = onChange.mock.calls.length;

    await commit(user, 'Day of Month', value);

    expect(lastValidity(onValidationChange)).toBe(false);
    expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
    expect(screen.getByText(DAY_ERROR)).toBeInTheDocument();
  });

  it('keeps the chosen day of month valid after tabbing through the field', async () => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    await user.click(screen.getByRole('tab', { name: 'Monthly' }));
    const callsBeforeEdit = onChange.mock.calls.length;

    // The field shows the "1st" label for day 1. Leaving it unchanged must
    // not save that label as the day.
    await user.click(field('Day of Month'));
    await user.tab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(field('Day of Month')).toHaveValue('1st');
    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
  });

  it('accepts a typed day-of-month label such as "15th"', async () => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    await user.click(screen.getByRole('tab', { name: 'Monthly' }));
    await commit(user, 'Hour', '12');
    await commit(user, 'Minute', '30');

    await commit(user, 'Day of Month', '15th');

    const { utcHour, utcMinute, dayOffset } = localTimeToUTC(12, 30);
    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0]).toBe(
      `${utcMinute} ${utcHour} ${15 + dayOffset} * *`
    );
  });
});

describe('SchedulePicker editing an existing Automation', () => {
  // Midday local times keep the UTC conversion on the same calendar day for
  // typical test time zones; the day offset is still applied where needed.
  const local = { hour: 12, minute: 30 };
  const { utcHour, utcMinute, dayOffset } = localTimeToUTC(
    local.hour,
    local.minute
  );

  it.each([
    ['daily', `${utcMinute} ${utcHour} * * *`],
    ['weekly', `${utcMinute} ${utcHour} * * ${(1 + dayOffset + 7) % 7}`],
    ['monthly', `${utcMinute} ${utcHour} ${15 + dayOffset} * *`],
  ])('loads a valid %s schedule without errors', (_type, cron) => {
    const { onChange, onValidationChange } = renderPicker(cron);

    expect(field('Hour')).toHaveValue('12');
    expect(field('Minute')).toHaveValue('30');
    expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(MINUTE_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    // Nothing is emitted when the loaded cron already matches the fields.
    expect(onChange.mock.lastCall?.[0] ?? cron).toBe(cron);
  });

  it('keeps a loaded monthly day valid after tabbing through the field', async () => {
    const user = userEvent.setup();
    const cron = `${utcMinute} ${utcHour} ${15 + dayOffset} * *`;
    const { onChange, onValidationChange } = renderPicker(cron);
    expect(field('Day of Month')).toHaveValue('15th');

    await user.click(field('Day of Month'));
    await user.tab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(field('Day of Month')).toHaveValue('15th');
    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0] ?? cron).toBe(cron);
  });

  it('loads a valid one-time schedule without errors', () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const oneTime = localTimeToUTC(local.hour, local.minute, date);
    const utcDate = new Date(date);
    utcDate.setDate(utcDate.getDate() + oneTime.dayOffset);
    const cron = `${oneTime.utcMinute} ${oneTime.utcHour} ${utcDate.getDate()} ${
      utcDate.getMonth() + 1
    } *`;

    const { onValidationChange } = renderPicker(cron);

    expect(screen.getByRole('tab', { name: 'One Time' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(field('Hour')).toHaveValue('12');
    expect(field('Minute')).toHaveValue('30');
    expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
  });
});
