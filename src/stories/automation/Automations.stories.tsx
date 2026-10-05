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

import { RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { AutomationDashboardView } from '@/components/Trigger/AutomationDashboard';
import { AutomationExamples } from '@/components/Trigger/AutomationExamples';
import { AutomationMainPanel } from '@/components/Trigger/AutomationMainPanel';
import { scheduleToCron } from '@/components/Trigger/automationSchedule';
import { SchedulePicker } from '@/components/Trigger/SchedulePicker';
import { TriggerListItem } from '@/components/Trigger/TriggerListItem';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import '@/i18n';
import {
  applyThemeContractV2,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens';
import { cn } from '@/lib/utils';
import {
  ExecutionStatus,
  ExecutionType,
  Trigger,
  TriggerExecution,
  TriggerStatus,
  TriggerType,
} from '@/types';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

// The app's ThemeProvider resolves color tokens at runtime; Storybook needs the same.
function applyTheme(mode: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', mode);
  applyThemeContractV2(
    createDefaultThemeContractV2(mode, { themeId: 'eigent' }),
    document.documentElement
  );
}
applyTheme('light');

const daysAgo = (days: number, hour: number, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const baseTrigger = {
  user_id: 'sample',
  description: 'A short report to help plan the next steps.',
  task_prompt:
    'Review recent changes and open tasks. Summarize what needs attention and suggest the next three priorities.',
  trigger_type: TriggerType.Schedule,
  is_single_execution: false,
  config: { max_failure_count: 5 },
};

const SAMPLE_TRIGGERS: Trigger[] = [
  {
    ...baseTrigger,
    id: 2,
    name: 'Weekly flaky test report',
    status: TriggerStatus.Active,
    custom_cron_expression: scheduleToCron({
      frequency: 'weekly',
      hour: 9,
      minute: 0,
      weekdays: [1],
    }),
    execution_count: 4,
    consecutive_failures: 0,
  },
  {
    ...baseTrigger,
    id: 1,
    name: 'Daily standup summary',
    status: TriggerStatus.Active,
    custom_cron_expression: scheduleToCron({
      frequency: 'daily',
      hour: 9,
      minute: 30,
    }),
    execution_count: 4,
    consecutive_failures: 2,
  },
  {
    ...baseTrigger,
    id: 3,
    name: 'test',
    status: TriggerStatus.Inactive,
    custom_cron_expression: scheduleToCron({
      frequency: 'daily',
      hour: 17,
      minute: 40,
    }),
    execution_count: 0,
  },
];

const run = (
  id: number,
  status: ExecutionStatus,
  startedAt: string,
  extra: Partial<TriggerExecution> = {}
): TriggerExecution => ({
  id,
  trigger_id: 2,
  execution_id: `sample-${id}`,
  execution_type: ExecutionType.Scheduled,
  status,
  started_at: startedAt,
  attempts: 1,
  max_retries: 0,
  ...extra,
});

const WEEKLY_RUNS: TriggerExecution[] = [
  run(4, ExecutionStatus.Completed, daysAgo(4, 9), { duration_seconds: 190 }),
  run(3, ExecutionStatus.Completed, daysAgo(11, 9), { duration_seconds: 178 }),
  run(2, ExecutionStatus.Completed, daysAgo(18, 9), { duration_seconds: 204 }),
  run(1, ExecutionStatus.Missed, daysAgo(25, 9)),
];

const STANDUP_RUNS: TriggerExecution[] = [
  run(16, ExecutionStatus.Missed, daysAgo(1, 9, 30)),
  run(15, ExecutionStatus.Missed, daysAgo(2, 9, 30)),
  run(14, ExecutionStatus.Completed, daysAgo(3, 9, 30), {
    duration_seconds: 112,
  }),
  run(13, ExecutionStatus.Failed, daysAgo(4, 9, 30), {
    error_message:
      'Execution failed: GitHub returned 401. Reconnect GitHub in Configuration.',
  }),
];

function AutomationsPage({
  triggers,
  initialSelectedId = null,
}: {
  triggers: Trigger[];
  initialSelectedId?: number | null;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    initialSelectedId
  );
  const [items, setItems] = useState(triggers);
  const toggle = (item: Trigger) =>
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              status:
                entry.status === TriggerStatus.Active
                  ? TriggerStatus.Inactive
                  : TriggerStatus.Active,
            }
          : entry
      )
    );
  const selected = items.find((trigger) => trigger.id === selectedId);
  const runsFor = (id: number) =>
    id === 2 ? WEEKLY_RUNS : id === 1 ? STANDUP_RUNS : [];

  return (
    <div className="flex h-[720px] w-[1440px] max-w-[calc(100vw-64px)] flex-col overflow-hidden rounded-ds-panel border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default lg:flex-row">
      <AutomationMainPanel
        trigger={selected ?? null}
        onBack={() => setSelectedId(null)}
        onEdit={fn()}
        onDelete={fn()}
        onToggleActive={toggle}
      >
        {selected ? (
          <div className="mx-auto w-full max-w-5xl">
            <AutomationDashboardView
              key={selected.id}
              trigger={selected}
              executions={runsFor(selected.id)}
            />
          </div>
        ) : (
          <AutomationExamples onSelectExample={fn()} />
        )}
      </AutomationMainPanel>
      <aside
        className={cn(
          'flex max-h-[40%] min-h-0 shrink-0 flex-col border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default lg:max-h-none lg:border-t-0 lg:border-r-0 lg:border-b-0 lg:border-l',
          RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS
        )}
      >
        <div className="flex h-[44px] shrink-0 items-center justify-between gap-ds-8 px-ds-16">
          <DsText as="h2" role="base" weight="semibold">
            Your automations
            <span className="ml-ds-6 font-medium text-ds-ink-subtle-default">
              {items.length}
            </span>
          </DsText>
          <Button variant="primary" size="sm">
            <Plus aria-hidden />
            Create
          </Button>
        </div>
        <ul className="scrollbar-always-visible m-0 flex min-h-0 flex-1 list-none flex-col gap-ds-2 overflow-y-auto pr-0 pb-ds-16 pl-ds-8">
          {items.length === 0 ? (
            <li className="m-ds-8 flex flex-col gap-ds-4 rounded-ds-card border border-x border-y border-dashed border-ds-hairline-default-default px-ds-16 py-ds-24 text-center">
              <DsText as="p" role="base" weight="semibold">
                No automations yet
              </DsText>
              <DsText as="p" role="base" className="text-ds-ink-muted-default">
                Try an example to set up your first one.
              </DsText>
            </li>
          ) : (
            items.map((trigger) => (
              <li key={trigger.id}>
                <TriggerListItem
                  trigger={trigger}
                  isSelected={trigger.id === selectedId}
                  onSelect={setSelectedId}
                  onRunNow={fn()}
                  onEdit={fn()}
                  onDelete={fn()}
                  onToggleActive={toggle}
                />
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}

const meta: Meta<typeof AutomationsPage> = {
  title: 'Automation/Automations page',
  component: AutomationsPage,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof AutomationsPage>;

export const NoAutomations: Story = {
  name: '1 · No automations',
  args: { triggers: [] },
};

export const WithAutomations: Story = {
  name: '2 · Examples with automations',
  args: { triggers: SAMPLE_TRIGGERS },
};

export const Dashboard: Story = {
  name: '3 · Dashboard and queue',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 2 },
};

export const DashboardWithFailures: Story = {
  name: '3b · Dashboard with runs that did not complete',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 1 },
};

export const SchedulePickerFirstRun: StoryObj<typeof SchedulePicker> = {
  name: '4 · Set up: schedule with first run',
  render: () => (
    <div className="w-[520px] rounded-ds-dialog bg-ds-neutral-subtle-default p-ds-24">
      <SchedulePicker
        value={scheduleToCron({
          frequency: 'weekly',
          hour: 9,
          minute: 0,
          weekdays: [1],
        })}
        onChange={fn()}
      />
    </div>
  ),
};

export const DashboardDark: Story = {
  name: '3d · Dashboard in dark mode',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 1 },
  beforeEach: () => {
    applyTheme('dark');
    return () => applyTheme('light');
  },
  decorators: [
    (Story) => (
      <div data-theme="dark">
        <Story />
      </div>
    ),
  ],
};

export const DashboardNoRuns: Story = {
  name: '3c · Dashboard with no runs yet',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 3 },
};

export const ManyAutomations: Story = {
  name: '5 · Large queue in a narrow window',
  args: {
    triggers: Array.from({ length: 20 }, (_, index) => ({
      ...SAMPLE_TRIGGERS[0],
      id: index + 10,
      name: `Scheduled report ${index + 1}`,
    })),
    initialSelectedId: 10,
  },
};

export const OneTimeNextYear: StoryObj<typeof SchedulePicker> = {
  name: '6 · Edit a one-time schedule in the next year',
  render: () => (
    <div className="w-[520px] rounded-ds-dialog bg-ds-neutral-subtle-default p-ds-24">
      <SchedulePicker
        value="0 9 5 1 *"
        isEditing
        initialConfig={{ date: `${new Date().getUTCFullYear() + 1}-01-05` }}
        onChange={fn()}
      />
    </div>
  ),
};

export const OneTimeFinished: StoryObj<typeof SchedulePicker> = {
  name: '7 · Edit a finished one-time schedule',
  render: () => (
    <div className="w-[520px] rounded-ds-dialog bg-ds-neutral-subtle-default p-ds-24">
      <SchedulePicker
        value="0 9 5 1 *"
        isEditing
        initialConfig={{ date: `${new Date().getUTCFullYear() - 1}-01-05` }}
        onChange={fn()}
      />
    </div>
  ),
};
