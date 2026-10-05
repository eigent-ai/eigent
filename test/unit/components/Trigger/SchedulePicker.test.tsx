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
    const change = vi.fn();
    render(
      <SchedulePicker value="0 0 * * *" useDefaultTime onChange={change} />
    );
    const expected = scheduleToCron({
      frequency: 'daily',
      hour: 13,
      minute: 0,
    });
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(expected));
  });
});
