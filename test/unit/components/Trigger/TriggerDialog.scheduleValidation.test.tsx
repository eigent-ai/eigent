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

import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { localTimeToUTC } from '@/lib/utils';
import {
  ListenerType,
  RequestType,
  TriggerStatus,
  TriggerType,
  type Trigger,
} from '@/types';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  proxyCreateTrigger: vi.fn(),
  proxyUpdateTrigger: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyCreateTrigger: mocks.proxyCreateTrigger,
  proxyUpdateTrigger: mocks.proxyUpdateTrigger,
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useTriggerCacheInvalidation: () => ({
    invalidateUserTriggerCount: vi.fn(),
  }),
  useTriggerConfigQuery: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ projectStore: { activeProjectId: 'project-1' } }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({ activeSpaceId: 'space-1', getProjectMeta: () => null }),
}));

vi.mock('@/store/triggerStore', () => ({
  useTriggerStore: () => ({ addTrigger: vi.fn(), updateTrigger: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

const HOUR_ERROR = 'Enter a whole number from 0 to 23';

function field(label: string): HTMLInputElement {
  const title = screen.getByText(label, { selector: 'span' });
  const input = title.parentElement?.parentElement?.querySelector('input');
  if (!input) throw new Error(`No input rendered for ${label}`);
  return input;
}

describe('TriggerDialog schedule time validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyCreateTrigger.mockImplementation(async (data) => ({
      id: 1,
      ...data,
    }));
  });

  it('blocks creating a daily Automation at 25:54 and creates it once the hour is valid', async () => {
    const user = userEvent.setup();
    render(
      <TriggerDialog selectedTrigger={null} isOpen onOpenChange={vi.fn()} />
    );

    await user.type(
      screen.getByPlaceholderText('Enter automation name'),
      'Nightly'
    );
    await user.type(
      screen.getByPlaceholderText('What should this automation do?'),
      'Say hello'
    );

    await user.clear(field('Minute'));
    await user.type(field('Minute'), '54');
    await user.keyboard('{Enter}');
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    // Type the invalid hour and go straight to Create without leaving the
    // field first.
    await user.clear(field('Hour'));
    await user.type(field('Hour'), '25');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mocks.proxyCreateTrigger).not.toHaveBeenCalled();
    expect(screen.getByText(HOUR_ERROR)).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Please fill in all required fields for the schedule'
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    await user.clear(field('Hour'));
    await user.type(field('Hour'), '23');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const { utcHour, utcMinute } = localTimeToUTC(23, 54);
    expect(mocks.proxyCreateTrigger).toHaveBeenCalledTimes(1);
    expect(mocks.proxyCreateTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nightly',
        task_prompt: 'Say hello',
        custom_cron_expression: `${utcMinute} ${utcHour} * * *`,
      })
    );
  });
});

describe('TriggerDialog saving a schedule the editor cannot show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyUpdateTrigger.mockImplementation(async (id, data) => ({
      id,
      ...data,
    }));
  });

  it.each([
    ['0 9 * * 1,3-5', false],
    ['0 9 1-5 1 *', true],
    ['0 9 1,15 * *', false],
  ])(
    'keeps %s and its run-once setting when only the name changes',
    async (cron, runsOnce) => {
      const user = userEvent.setup();
      const stored = {
        id: 7,
        name: 'Stored schedule',
        task_prompt: 'Summarize the inbox',
        trigger_type: TriggerType.Schedule,
        status: TriggerStatus.Inactive,
        custom_cron_expression: cron,
        is_single_execution: runsOnce,
        listener_type: ListenerType.Workforce,
        webhook_method: RequestType.POST,
        config: { max_failure_count: 5 },
      } as unknown as Trigger;
      render(
        <TriggerDialog selectedTrigger={stored} isOpen onOpenChange={vi.fn()} />
      );
      expect(
        screen.getByText(/This schedule can't be edited here/)
      ).toBeInTheDocument();

      const name = screen.getByPlaceholderText('Enter automation name');
      await user.clear(name);
      await user.type(name, 'Renamed schedule');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await vi.waitFor(() =>
        expect(mocks.proxyUpdateTrigger).toHaveBeenCalledTimes(1)
      );
      expect(mocks.proxyUpdateTrigger).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          name: 'Renamed schedule',
          custom_cron_expression: cron,
          is_single_execution: runsOnce,
        })
      );
    }
  );
});
