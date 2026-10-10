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

import { SchedulePicker } from '@/components/Trigger/SchedulePicker';
import {
  scheduleToCron,
  type LocalSchedule,
} from '@/components/Trigger/automationSchedule';
import { localTimeToUTC } from '@/lib/utils';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimeZone } from '../../../mocks/timeZone';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 12, 15));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('schedule initialization', () => {
  it('keeps a stored January date in the next year when edited in December', async () => {
    vi.setSystemTime(new Date(2026, 11, 15, 12));
    const valid = vi.fn();
    const config = vi.fn();
    render(
      <SchedulePicker
        value="0 9 5 1 *"
        isEditing
        initialConfig={{ date: '2027-01-05' }}
        onChange={vi.fn()}
        onConfigChange={config}
        onValidationChange={valid}
      />
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2027-01-05');
    await waitFor(() =>
      expect(config).toHaveBeenLastCalledWith(
        expect.objectContaining({ date: '2027-01-05' })
      )
    );
  });

  it('allows an unchanged past one-time schedule to be edited but rejects changing it to another past date', async () => {
    const valid = vi.fn();
    render(
      <SchedulePicker
        value="0 9 5 1 *"
        isEditing
        initialConfig={{ date: '2026-01-05' }}
        onChange={vi.fn()}
        onValidationChange={valid}
      />
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    expect(screen.getByText('No upcoming executions')).toBeInTheDocument();
    expect(
      screen.queryByText('Pick a date and time in the future.')
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Date/), {
      target: { value: '2026-02-05' },
    });
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
  });

  it('rejects a one-time date a year or more ahead, which cron would run a year early', async () => {
    const valid = vi.fn();
    render(
      <SchedulePicker
        value="0 9 5 1 *"
        initialConfig={{ date: '2028-01-05' }}
        onChange={vi.fn()}
        onValidationChange={valid}
      />
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
    expect(
      screen.getByText('Choose a date less than a year from today.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/First run/)).not.toBeInTheDocument();

    const date = screen.getByLabelText(/^Date/);
    expect(date).toHaveAttribute('max', '2027-10-04');
    fireEvent.change(date, { target: { value: '2027-10-05' } });
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
    fireEvent.change(date, { target: { value: '2027-10-04' } });
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    expect(screen.getByText(/First run/)).toBeInTheDocument();
  });

  it('rejects creating a one-time schedule in the past', async () => {
    const valid = vi.fn();
    render(
      <SchedulePicker
        value="0 9 5 1 *"
        initialConfig={{ date: '2026-01-05' }}
        onChange={vi.fn()}
        onValidationChange={valid}
      />
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
  });
  it.each([true, false])(
    'preserves midnight UTC for an existing schedule or an example draft (editing=%s)',
    async (isEditing) => {
      // From 00:15 UTC the next full local hour is never midnight UTC, in any
      // zone, so the picker's default always differs from the stored value.
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 0, 15)));
      const change = vi.fn();
      render(
        <SchedulePicker
          value="0 0 * * *"
          isEditing={isEditing}
          onChange={change}
        />
      );
      await waitFor(() => expect(change).toHaveBeenLastCalledWith('0 0 * * *'));
    }
  );

  it('starts only the blank create form at the next full local hour', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 0, 15)));
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const change = vi.fn();
    render(
      <SchedulePicker value="0 0 * * *" useDefaultTime onChange={change} />
    );
    const expected = scheduleToCron({
      frequency: 'daily',
      hour: nextHour.getHours(),
      minute: 0,
    });
    expect(expected).not.toBe('0 0 * * *');
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(expected));
  });
});

describe('stored schedules the editor cannot show', () => {
  it('keeps the stored cron and dates until a frequency is chosen', async () => {
    const change = vi.fn();
    const valid = vi.fn();
    const config = vi.fn();
    render(
      <SchedulePicker
        value="*/15 * * * *"
        isEditing
        initialConfig={{ expirationDate: '2026-12-31', max_failure_count: 3 }}
        onChange={change}
        onConfigChange={config}
        onValidationChange={valid}
      />
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    expect(change).not.toHaveBeenCalled();
    expect(config).toHaveBeenLastCalledWith({
      expirationDate: '2026-12-31',
      max_failure_count: 3,
    });
    expect(
      screen.getByText(/This schedule can't be edited here/)
    ).toBeInTheDocument();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', 'false');
    }

    // Moving focus into the tabs is not a choice.
    fireEvent.focus(screen.getByRole('tab', { name: 'One Time' }));
    expect(change).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Weekly' }));
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(
        scheduleToCron({
          frequency: 'weekly',
          hour: 13,
          minute: 0,
          weekdays: [1],
        })
      )
    );
  });
});

describe('a last-day monthly schedule after a DST change', () => {
  // New Zealand is UTC+13 in January and UTC+12 in July.
  useTimeZone('Pacific/Auckland');

  it('opens as monthly on day 1 instead of falling back to daily', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 15));
    const change = vi.fn();
    render(<SchedulePicker value="30 11 L * *" isEditing onChange={change} />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(change).toHaveBeenLastCalledWith(
      scheduleToCron({
        frequency: 'monthly',
        hour: 0,
        minute: 30,
        dayOfMonth: 1,
      })
    );
  });
});

const HOUR_ERROR = 'Enter a whole number from 0 to 23';
const MINUTE_ERROR = 'Enter a whole number from 0 to 59';
const DAY_ERROR = 'Enter a whole number from 1 to 31';
const FIX_FIELDS = 'Fix the highlighted fields to see scheduled times';
// Preview rows start with a long date such as "October 31, 2026".
const PREVIEW_ROW = /^\w+ \d{1,2}, \d{4}/;

type User = ReturnType<typeof userEvent.setup>;

function renderPicker(
  value = '0 0 * * *',
  props: { isEditing?: boolean } = {}
) {
  const onChange = vi.fn();
  const onValidationChange = vi.fn();
  render(
    <SchedulePicker
      value={value}
      onChange={onChange}
      onValidationChange={onValidationChange}
      {...props}
    />
  );
  return { onChange, onValidationChange };
}

function field(label: string): HTMLInputElement {
  const title = screen.getByText(label, { selector: 'span' });
  const input = title.parentElement?.parentElement?.querySelector('input');
  if (!input) throw new Error(`No input rendered for ${label}`);
  return input;
}

// The field commits its text on blur after a short delay.
const settleBlur = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 200)));

// Type into an InputSelect and commit with Enter, then let the field's
// delayed blur commit run so the next edit starts from a settled state.
async function commit(user: User, label: string, value: string) {
  const input = field(label);
  await user.clear(input);
  if (value) await user.type(input, value);
  await user.keyboard('{Enter}');
  await settleBlur();
}

function lastValidity(onValidationChange: ReturnType<typeof vi.fn>) {
  return onValidationChange.mock.lastCall?.[0];
}

const notice = () => screen.getByRole('status');

async function openPreview(user: User) {
  await user.click(screen.getByText('Preview Scheduled Times'));
  return screen
    .queryAllByText(PREVIEW_ROW)
    .map((row) => row.textContent?.match(PREVIEW_ROW)?.[0]);
}

describe('SchedulePicker time validation', () => {
  it('rejects 25:54 on a daily schedule instead of rolling it over to 01:54', async () => {
    const user = userEvent.setup();
    const { onChange, onValidationChange } = renderPicker();
    const callsBeforeEdit = onChange.mock.calls.length;

    await commit(user, 'Hour', '25');
    await commit(user, 'Minute', '54');

    expect(lastValidity(onValidationChange)).toBe(false);
    // No cron is generated from the invalid hour.
    expect(onChange).not.toHaveBeenCalledWith(
      scheduleToCron({ frequency: 'daily', hour: 1, minute: 54 })
    );
    expect(onChange.mock.calls.length).toBe(callsBeforeEdit);
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
    expect(notice()).toHaveTextContent(FIX_FIELDS);
    expect(notice()).not.toHaveTextContent(/01:54/);
    expect(await openPreview(user)).toEqual([]);

    await commit(user, 'Hour', '23');

    expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
    expect(notice()).not.toHaveTextContent(FIX_FIELDS);
    expect(notice()).toHaveTextContent(/23:54/);
    expect(screen.getAllByText(/11:54 PM/)).toHaveLength(5);
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0]).toBe(
      scheduleToCron({ frequency: 'daily', hour: 23, minute: 54 })
    );
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
    expect(notice()).toHaveTextContent(FIX_FIELDS);
  });

  it('highlights a cleared hour so the notice points at it', async () => {
    const user = userEvent.setup();
    const { onValidationChange } = renderPicker();

    await commit(user, 'Hour', '');

    expect(lastValidity(onValidationChange)).toBe(false);
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
    expect(notice()).toHaveTextContent(FIX_FIELDS);
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

      // Later today, so the default one-time date is still in the future.
      await commit(user, 'Hour', '23');
      await commit(user, 'Minute', '05');

      expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
      expect(screen.queryByText(MINUTE_ERROR)).not.toBeInTheDocument();
      expect(lastValidity(onValidationChange)).toBe(true);
      const { utcHour, utcMinute } = localTimeToUTC(23, 5);
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
    expect(notice()).toHaveTextContent(FIX_FIELDS);
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
    await settleBlur();

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

    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0]).toBe(
      scheduleToCron({
        frequency: 'monthly',
        hour: 12,
        minute: 30,
        dayOfMonth: 15,
      })
    );
  });
});

describe('SchedulePicker editing an existing Automation', () => {
  const time = { hour: 12, minute: 30 };

  it.each<LocalSchedule>([
    { frequency: 'daily', ...time },
    { frequency: 'weekly', ...time, weekdays: [1] },
    { frequency: 'monthly', ...time, dayOfMonth: 15 },
  ])('loads a valid $frequency schedule without errors', (schedule) => {
    const cron = scheduleToCron(schedule);
    const { onChange, onValidationChange } = renderPicker(cron, {
      isEditing: true,
    });

    expect(field('Hour')).toHaveValue('12');
    expect(field('Minute')).toHaveValue('30');
    expect(screen.queryByText(HOUR_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(MINUTE_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    // Nothing is emitted when the loaded cron already matches the fields.
    expect(onChange.mock.lastCall?.[0] ?? cron).toBe(cron);
  });

  it('keeps a loaded monthly day valid after tabbing through the field', async () => {
    const user = userEvent.setup();
    const cron = scheduleToCron({
      frequency: 'monthly',
      ...time,
      dayOfMonth: 15,
    });
    const { onChange, onValidationChange } = renderPicker(cron, {
      isEditing: true,
    });
    expect(field('Day of Month')).toHaveValue('15th');

    await user.click(field('Day of Month'));
    await user.tab();
    await settleBlur();

    expect(field('Day of Month')).toHaveValue('15th');
    expect(screen.queryByText(DAY_ERROR)).not.toBeInTheDocument();
    expect(lastValidity(onValidationChange)).toBe(true);
    expect(onChange.mock.lastCall?.[0] ?? cron).toBe(cron);
  });

  it('loads a valid one-time schedule without errors', () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const cron = scheduleToCron({ frequency: 'once', ...time, date });

    const { onValidationChange } = renderPicker(cron, { isEditing: true });

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

describe('schedule preview across month and year ends', () => {
  // A zone without DST, where 09:00 local stays on the same UTC day.
  useTimeZone('Asia/Shanghai');

  it.each<[string, LocalSchedule, [number, number, number], string[]]>([
    [
      'daily runs across a month end',
      { frequency: 'daily', hour: 9, minute: 0 },
      [2026, 9, 30],
      [
        'October 31, 2026',
        'November 1, 2026',
        'November 2, 2026',
        'November 3, 2026',
        'November 4, 2026',
      ],
    ],
    [
      'weekly runs across a month end',
      { frequency: 'weekly', hour: 9, minute: 0, weekdays: [1, 3] },
      [2026, 9, 27],
      [
        'October 28, 2026',
        'November 2, 2026',
        'November 4, 2026',
        'November 9, 2026',
        'November 11, 2026',
      ],
    ],
    [
      'monthly runs across a year end',
      { frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 15 },
      [2026, 10, 20],
      [
        'December 15, 2026',
        'January 15, 2027',
        'February 15, 2027',
        'March 15, 2027',
        'April 15, 2027',
      ],
    ],
    [
      'a monthly day 31 only in months that have it',
      { frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 31 },
      [2027, 0, 15],
      [
        'January 31, 2027',
        'March 31, 2027',
        'May 31, 2027',
        'July 31, 2027',
        'August 31, 2027',
      ],
    ],
  ])('lists %s in order', async (_case, schedule, [y, m, d], expected) => {
    vi.setSystemTime(new Date(y, m, d, 10));
    const user = userEvent.setup();
    renderPicker(scheduleToCron(schedule), { isEditing: true });

    expect(await openPreview(user)).toEqual(expected);
  });
});
