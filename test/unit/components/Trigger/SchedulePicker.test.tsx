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
import { scheduleToCron } from '@/components/Trigger/automationSchedule';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
