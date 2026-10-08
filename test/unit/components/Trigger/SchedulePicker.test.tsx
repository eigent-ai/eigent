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
