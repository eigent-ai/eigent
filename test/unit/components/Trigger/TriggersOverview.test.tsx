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
  proxyRunTriggerNow: vi.fn(),
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

vi.mock('@/components/Trigger/TriggerDialog', () => ({
  TriggerDialog: () => null,
}));

vi.mock('@/components/Trigger/TriggerListItem', () => ({
  TriggerListItem: ({ trigger }: { trigger: Trigger }) => (
    <div data-testid="automation-row">{trigger.name}</div>
  ),
}));

const EMPTY_LIST = 'No automations yet';

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
  selectedTriggerId: null,
  onSelectedTriggerIdChange: vi.fn(),
  isDialogOpen: false,
  onDialogOpenChange: vi.fn(),
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
    expect(screen.queryByText(EMPTY_LIST)).not.toBeInTheDocument();
    // Another Session's automations must not linger in the list.
    expect(screen.queryByTestId('automation-row')).not.toBeInTheDocument();
  });

  it('shows loading instead of the empty list while the list loads', async () => {
    mocks.projectState.activeProjectId = 'project-1';

    render(<Overview {...props} />);
    await act(async () => {});

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_LIST)).not.toBeInTheDocument();
    expect(mocks.fetchProjectTriggers).toHaveBeenCalledWith('project-1');
  });

  it('shows a load failure with retry instead of the empty list', async () => {
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
    expect(screen.queryByText(EMPTY_LIST)).not.toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Morning digest')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.fetchProjectTriggers).toHaveBeenCalledTimes(2);
    expect(mocks.fetchProjectTriggers).toHaveBeenNthCalledWith(1, 'project-1');
    expect(mocks.fetchProjectTriggers).toHaveBeenNthCalledWith(2, 'project-1');
  });

  it('lists an automation created after the list failed to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.projectState.activeProjectId = 'project-1';
    mocks.fetchProjectTriggers.mockRejectedValueOnce(new Error('network down'));

    render(<Overview {...props} />);
    await screen.findByRole('alert');

    act(() => {
      useTriggerStore.getState().addTrigger(automation);
    });

    expect(screen.getByText('Morning digest')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the Session automations once across re-renders', async () => {
    mocks.projectState.activeProjectId = 'project-1';
    mocks.fetchProjectTriggers.mockResolvedValueOnce({ items: [] });

    const { rerender } = render(<Overview {...props} />);
    expect(await screen.findByText(EMPTY_LIST)).toBeInTheDocument();

    // Unrelated project store updates hand out a new store object while the
    // same Session stays selected.
    for (let update = 0; update < 2; update += 1) {
      mocks.projectState = { ...mocks.projectState };
      rerender(<Overview {...props} />);
      await act(async () => {});
    }

    expect(mocks.fetchProjectTriggers).toHaveBeenCalledTimes(1);
  });

  it('ignores a late reply for a Session that is no longer selected', async () => {
    let resolveFirst!: (value: { items: Trigger[] }) => void;
    mocks.fetchProjectTriggers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ items: [] });
    mocks.projectState.activeProjectId = 'project-1';

    const { rerender } = render(<Overview {...props} />);
    await act(async () => {});

    mocks.projectState = { activeProjectId: 'project-2' };
    rerender(<Overview {...props} />);
    expect(await screen.findByText(EMPTY_LIST)).toBeInTheDocument();

    await act(async () => {
      resolveFirst({ items: [automation] });
    });

    expect(screen.queryByText('Morning digest')).not.toBeInTheDocument();
    expect(mocks.fetchProjectTriggers).toHaveBeenNthCalledWith(2, 'project-2');
  });
});
