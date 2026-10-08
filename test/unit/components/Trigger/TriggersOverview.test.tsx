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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Overview, { type OverviewProps } from '@/components/Trigger/Triggers';
import { useTriggerStore } from '@/store/triggerStore';
import { type Trigger, TriggerStatus, TriggerType } from '@/types';

const mocks = vi.hoisted(() => ({
  fetchProjectTriggers: vi.fn(),
  projectState: { activeProjectId: null as string | null },
  toastError: vi.fn(),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchProjectTriggers: mocks.fetchProjectTriggers,
  proxyActivateTrigger: vi.fn(),
  proxyDeactivateTrigger: vi.fn(),
  proxyDeleteTrigger: vi.fn(),
}));

// The real project store hook returns a new store object whenever any
// project store state changes; tests swap `mocks.projectState` to mimic that.
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: null,
    projectStore: mocks.projectState,
  }),
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useTriggerCacheInvalidation: () => ({
    invalidateUserTriggerCount: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('@/components/Trigger/ExecutionLogs', () => ({
  ExecutionLogs: () => null,
}));

vi.mock('@/components/Trigger/TriggerDialog', () => ({
  TriggerDialog: () => null,
}));

vi.mock('@/components/Trigger/TriggerListItem', () => ({
  TriggerListItem: ({ trigger }: { trigger: Trigger }) => (
    <div data-testid="automation-row">{trigger.name}</div>
  ),
}));

const CREATE_GUIDE = 'Create an automation to run tasks for you';

const automation: Trigger = {
  id: 1,
  user_id: '7',
  name: 'Morning digest',
  project_id: 'project-1',
  description: '',
  trigger_type: TriggerType.Schedule,
  status: TriggerStatus.Active,
  is_single_execution: false,
};

const props: OverviewProps = {
  sortBy: 'createdAt',
  selectedTriggerId: null,
  onSelectedTriggerIdChange: vi.fn(),
  isExecutionLogsOpen: false,
  onExecutionLogsOpenChange: vi.fn(),
};

describe('Workspace automations list', () => {
  beforeEach(() => {
    // Requests beyond the ones a test expects stay pending.
    mocks.fetchProjectTriggers
      .mockReset()
      .mockImplementation(() => new Promise(() => {}));
    mocks.toastError.mockReset();
    mocks.projectState = { activeProjectId: null };
    useTriggerStore.setState({ triggers: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not request automations before a Session is selected', async () => {
    useTriggerStore.setState({ triggers: [automation] });

    render(<Overview {...props} />);
    await act(async () => {});

    expect(mocks.fetchProjectTriggers).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(CREATE_GUIDE)).not.toBeInTheDocument();
    // Another Session's automations must not linger in the list.
    expect(screen.queryByTestId('automation-row')).not.toBeInTheDocument();
  });

  it('shows loading instead of the create guide while the list loads', async () => {
    mocks.projectState.activeProjectId = 'project-1';

    render(<Overview {...props} />);
    await act(async () => {});

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText(CREATE_GUIDE)).not.toBeInTheDocument();
    expect(mocks.fetchProjectTriggers).toHaveBeenCalledWith('project-1');
  });

  it('shows a load failure with retry instead of the create guide', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.projectState.activeProjectId = 'project-1';
    mocks.fetchProjectTriggers
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ items: [automation] });

    render(<Overview {...props} />);

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Failed to load automations')
    ).toBeInTheDocument();
    expect(screen.queryByText(CREATE_GUIDE)).not.toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Morning digest')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.fetchProjectTriggers).toHaveBeenCalledTimes(2);
    expect(mocks.fetchProjectTriggers).toHaveBeenNthCalledWith(1, 'project-1');
    expect(mocks.fetchProjectTriggers).toHaveBeenNthCalledWith(2, 'project-1');
  });

  it('loads the Session automations once across re-renders', async () => {
    mocks.projectState.activeProjectId = 'project-1';
    mocks.fetchProjectTriggers.mockResolvedValueOnce({ items: [] });

    const { rerender } = render(<Overview {...props} />);
    expect(await screen.findByText(CREATE_GUIDE)).toBeInTheDocument();

    // Unrelated project store updates hand out a new store object while the
    // same Session stays selected.
    for (let update = 0; update < 2; update += 1) {
      mocks.projectState = { ...mocks.projectState };
      rerender(<Overview {...props} />);
      await act(async () => {});
    }

    expect(mocks.fetchProjectTriggers).toHaveBeenCalledTimes(1);
  });
});
