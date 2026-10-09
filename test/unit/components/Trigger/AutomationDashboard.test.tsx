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
  AutomationDashboard,
  AutomationDashboardView,
} from '@/components/Trigger/AutomationDashboard';
import { AutomationMainPanel } from '@/components/Trigger/AutomationMainPanel';
import { scheduleToCron } from '@/components/Trigger/automationSchedule';
import { TriggerListItem } from '@/components/Trigger/TriggerListItem';
import { proxyFetchTriggerExecutions } from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import {
  ExecutionStatus,
  ExecutionType,
  Trigger,
  TriggerExecution,
  TriggerStatus,
  TriggerType,
} from '@/types';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggerExecutions: vi.fn(),
}));

const trigger: Trigger = {
  id: 1,
  user_id: 'test',
  name: 'Daily brief',
  description: 'A summary of open work.',
  trigger_type: TriggerType.Schedule,
  status: TriggerStatus.Inactive,
  custom_cron_expression: scheduleToCron({
    frequency: 'daily',
    hour: 9,
    minute: 30,
  }),
  task_prompt: 'Review open tasks.\nSuggest three priorities.',
  is_single_execution: false,
};
const execution: TriggerExecution = {
  id: 11,
  trigger_id: 1,
  execution_id: 'test',
  execution_type: ExecutionType.Scheduled,
  status: ExecutionStatus.Missed,
  created_at: '2026-10-03T09:30:00Z',
  attempts: 0,
  max_retries: 0,
};
afterEach(() => {
  cleanup();
  useActivityLogStore.getState().clearLogs();
  vi.clearAllMocks();
});

function Details({
  onEdit = vi.fn(),
  onToggleActive = vi.fn(),
  ...props
}: ComponentProps<typeof AutomationDashboardView> & {
  onEdit?: (trigger: Trigger) => void;
  onToggleActive?: (trigger: Trigger) => void;
}) {
  return (
    <AutomationMainPanel
      trigger={props.trigger}
      onBack={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
      onToggleActive={onToggleActive}
    >
      <AutomationDashboardView {...props} />
    </AutomationMainPanel>
  );
}

describe('automation details and compact list', () => {
  it('keeps expanded history visible while a background refresh is pending or fails', async () => {
    let rejectRefresh!: (reason: Error) => void;
    vi.mocked(proxyFetchTriggerExecutions)
      .mockResolvedValueOnce([
        {
          ...execution,
          status: ExecutionStatus.Completed,
          output_data: { summary: 'Saved priorities' },
        },
      ])
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject;
          })
      );
    render(<AutomationDashboard trigger={trigger} />);
    const row = await screen.findByRole('button', { name: /Completed/ });
    fireEvent.click(row);
    act(() =>
      useActivityLogStore.getState().addLog({
        type: ActivityType.TriggerExecuted,
        message: 'Started',
        triggerId: trigger.id,
      })
    );
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Saved priorities/)).toBeInTheDocument();
    expect(
      screen.queryByText('Loading execution data...')
    ).not.toBeInTheDocument();
    await act(async () => rejectRefresh(new Error('Offline')));
    expect(
      screen.getByText('Failed to load execution data')
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved priorities/)).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });
  it('ignores an older response after a completion refresh, including an updated log with the same ID', async () => {
    let resolveInitial!: (value: TriggerExecution[]) => void;
    vi.mocked(proxyFetchTriggerExecutions)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve;
          })
      )
      .mockResolvedValueOnce([
        { ...execution, status: ExecutionStatus.Running },
      ])
      .mockResolvedValueOnce([
        { ...execution, status: ExecutionStatus.Running },
      ])
      .mockResolvedValueOnce([
        { ...execution, status: ExecutionStatus.Completed },
      ]);
    render(<AutomationDashboard trigger={trigger} />);
    act(() =>
      useActivityLogStore.getState().addLog({
        type: ActivityType.TriggerExecuted,
        message: 'Started',
        triggerId: trigger.id,
        executionId: execution.execution_id,
      })
    );
    await screen.findByRole('button', { name: /Running/ });
    act(() =>
      useActivityLogStore.getState().addLog({
        type: ActivityType.TriggerExecuted,
        message: 'Another run started',
        triggerId: trigger.id,
        executionId: 'newer-run',
      })
    );
    await screen.findByRole('button', { name: /Running/ });
    act(() => {
      useActivityLogStore.getState().modifyLog(execution.execution_id, {
        type: ActivityType.ExecutionSuccess,
        message: 'Completed',
      });
    });
    await screen.findByRole('button', { name: /Completed/ });
    await act(async () =>
      resolveInitial([{ ...execution, status: ExecutionStatus.Pending }])
    );
    expect(
      screen.getByRole('button', { name: /Completed/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Pending/ })
    ).not.toBeInTheDocument();
    expect(proxyFetchTriggerExecutions).toHaveBeenCalledTimes(4);
  });
  it('routes the Automations breadcrumb and title-menu delete action correctly', async () => {
    const back = vi.fn();
    const remove = vi.fn();
    render(
      <AutomationMainPanel
        trigger={trigger}
        onBack={back}
        onEdit={vi.fn()}
        onDelete={remove}
        onToggleActive={vi.fn()}
      >
        <div />
      </AutomationMainPanel>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Automations' }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByText('Daily brief')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for Daily brief' })
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith(trigger);
  });

  it('retains loading and fetch-error states without showing an empty history', () => {
    const props = {
      trigger,
      executions: [],
      onEdit: vi.fn(),
      onToggleActive: vi.fn(),
    };
    const { rerender } = render(<Details {...props} loading />);
    expect(screen.getByText('Loading execution data...')).toBeInTheDocument();
    expect(screen.queryByText('No executions yet')).not.toBeInTheDocument();
    rerender(<Details {...props} loadError />);
    expect(
      screen.getByText('Failed to load execution data')
    ).toBeInTheDocument();
  });

  it('shows stored output and the execution identifier when a completed run expands', () => {
    render(
      <Details
        trigger={trigger}
        executions={[
          {
            ...execution,
            status: ExecutionStatus.Completed,
            output_data: { summary: 'Three priorities saved' },
          },
        ]}
        onEdit={vi.fn()}
        onToggleActive={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    expect(screen.getByText(/Three priorities saved/)).toBeInTheDocument();
    expect(screen.getByText(/Execution ID/)).toHaveTextContent('test');
  });

  it('shows real instructions and routes edit and resume to the selected automation', async () => {
    const edit = vi.fn();
    const toggle = vi.fn();
    render(
      <Details
        trigger={trigger}
        executions={[]}
        onEdit={edit}
        onToggleActive={toggle}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'When it runs' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Review open tasks/)).toHaveTextContent(
      'Suggest three priorities.'
    );
    expect(
      screen.queryByRole('button', { name: 'Edit instructions' })
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for Daily brief' })
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Edit', 'Delete']);
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Edit', exact: true })
    );
    expect(edit).toHaveBeenCalledWith(trigger);
    const toggleSwitch = screen.getByRole('switch', { name: 'Daily brief' });
    expect(toggleSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggleSwitch);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(trigger));
  });

  it('expands the actual skip reason and does not invent a closed-app cause when unknown', () => {
    const props = { trigger, onEdit: vi.fn(), onToggleActive: vi.fn() };
    const { rerender } = render(
      <Details {...props} executions={[execution]} />
    );
    const row = screen.getByRole('button', { name: /Not started/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Execution was missed')).toBeInTheDocument();
    expect(screen.queryByText(/was not open/)).not.toBeInTheDocument();
    rerender(
      <Details
        {...props}
        executions={[
          {
            ...execution,
            skip_reason: {
              code: 'space_disconnected',
              message: 'This Space is disconnected.',
            },
          },
        ]}
      />
    );
    expect(screen.getByText('This Space is disconnected.')).toBeInTheDocument();
  });

  it('preserves verification gating and event-based details', () => {
    render(
      <Details
        trigger={{
          ...trigger,
          trigger_type: TriggerType.Webhook,
          status: TriggerStatus.PendingAuth,
          config: { authentication_required: true },
        }}
        executions={[]}
        onEdit={vi.fn()}
        onToggleActive={vi.fn()}
      />
    );
    expect(
      screen.getByText('Runs when an event is received')
    ).toBeInTheDocument();
    expect(screen.queryByText('Local time')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Daily brief' })).toBeDisabled();
  });

  it('routes Run now to the selected item without toggling its schedule', async () => {
    const runNow = vi.fn();
    const toggle = vi.fn();
    const select = vi.fn();
    const active = { ...trigger, status: TriggerStatus.Active };
    render(
      <TriggerListItem
        trigger={active}
        isSelected
        onRunNow={runNow}
        onToggleActive={toggle}
        onSelect={select}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for Daily brief' })
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Run now', 'Pause', 'Edit', 'Delete']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect(runNow).toHaveBeenCalledWith(active);
    expect(toggle).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('disables Run now and Resume while verification is required', async () => {
    render(
      <TriggerListItem
        trigger={{
          ...trigger,
          status: TriggerStatus.PendingAuth,
          config: { authentication_required: true },
        }}
        isSelected
        onRunNow={vi.fn()}
        onToggleActive={vi.fn()}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for Daily brief' })
    );
    expect(screen.getByRole('menuitem', { name: 'Run now' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Resume' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Edit' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('keeps list selection independent from the four menu actions', async () => {
    const select = vi.fn();
    const toggle = vi.fn();
    render(
      <TriggerListItem
        trigger={trigger}
        isSelected
        onSelect={select}
        onToggleActive={toggle}
        onRunNow={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for Daily brief' })
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Run now', 'Resume', 'Edit', 'Delete']);
    const icon = (name: string) =>
      screen
        .getByRole('menuitem', { name })
        .querySelector('svg')
        ?.getAttribute('class');
    expect(icon('Resume')).toBeTruthy();
    expect(icon('Resume')).not.toBe(icon('Run now'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume' }));
    expect(toggle).toHaveBeenCalledWith(trigger);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Daily brief Paused/ }));
    expect(select).toHaveBeenCalledWith(trigger.id);
    const row = screen.getByRole('button', { name: /Daily brief Paused/ });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).not.toHaveAttribute('aria-pressed');
  });
});
