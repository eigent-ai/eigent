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

import { AutomationDashboardView } from '@/components/Trigger/AutomationDashboard';
import type { AutomationRoleId } from '@/components/Trigger/automationExampleData';
import { AutomationExamples } from '@/components/Trigger/AutomationExamples';
import { scheduleToCron } from '@/components/Trigger/automationSchedule';
import { ProfileNudge } from '@/components/Trigger/ProfileNudge';
import { SchedulePicker } from '@/components/Trigger/SchedulePicker';
import { TriggerListItem } from '@/components/Trigger/TriggerListItem';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import '@/i18n';
import {
  applyThemeContractV2,
  createDefaultThemeContractV2,
} from '@/lib/themeTokens';
import { useAutomationProfileStore } from '@/store/automationProfileStore';
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
  description: '',
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

function withRole(role: AutomationRoleId | null) {
  useAutomationProfileStore.setState({ role, nudgeDismissed: false });
}

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
  const selected = triggers.find((trigger) => trigger.id === selectedId);
  const runsFor = (id: number) =>
    id === 2 ? WEEKLY_RUNS : id === 1 ? STANDUP_RUNS : [];

  return (
    <div className="flex h-[720px] w-[1180px] max-w-full overflow-hidden rounded-ds-panel border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
      <section className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-y-auto px-ds-24 xl:px-ds-page-gutter">
        {selected ? (
          <div className="mx-auto w-full max-w-3xl">
            <AutomationDashboardView
              trigger={selected}
              executions={runsFor(selected.id)}
              onBack={() => setSelectedId(null)}
              onEdit={fn()}
            />
          </div>
        ) : (
          <AutomationExamples onSelectExample={fn()} />
        )}
      </section>
      <aside className="flex w-80 shrink-0 flex-col border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
        <div className="flex items-center justify-between gap-ds-8 px-ds-16 pt-ds-16 pb-ds-8">
          <DsText as="h2" role="base" weight="semibold">
            Your automations
            <span className="ml-ds-6 font-medium text-ds-ink-subtle-default">
              {triggers.length}
            </span>
          </DsText>
          <Button variant="primary" size="sm">
            <Plus aria-hidden />
            Create
          </Button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-ds-2 px-ds-8 pb-ds-16">
          {triggers.length === 0 ? (
            <li className="m-ds-8 flex flex-col gap-ds-4 rounded-ds-card border border-x border-y border-dashed border-ds-hairline-default-default px-ds-16 py-ds-24 text-center">
              <DsText as="p" role="base" weight="semibold">
                No automations yet
              </DsText>
              <DsText as="p" role="base" className="text-ds-ink-muted-default">
                Try an example to set up your first one.
              </DsText>
            </li>
          ) : (
            triggers.map((trigger) => (
              <li key={trigger.id}>
                <TriggerListItem
                  trigger={trigger}
                  isSelected={trigger.id === selectedId}
                  onSelect={setSelectedId}
                  onEdit={fn()}
                  onDelete={fn()}
                  onToggleActive={fn()}
                />
              </li>
            ))
          )}
        </ul>
      </aside>
      <ProfileNudge onRoleSaved={fn()} />
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

export const ProfileSetNoAutomations: Story = {
  name: '1a · Profile set, no automations',
  args: { triggers: [] },
  beforeEach: () => withRole('software-engineer'),
};

export const NoProfileNoAutomations: Story = {
  name: '1b · No profile, no automations',
  args: { triggers: [] },
  beforeEach: () => withRole(null),
};

export const WithAutomations: Story = {
  name: '2 · Examples with automations',
  args: { triggers: SAMPLE_TRIGGERS },
  beforeEach: () => withRole('software-engineer'),
};

export const Dashboard: Story = {
  name: '3 · Dashboard and queue',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 2 },
  beforeEach: () => withRole('software-engineer'),
};

export const DashboardWithFailures: Story = {
  name: '3b · Dashboard with runs that did not complete',
  args: { triggers: SAMPLE_TRIGGERS, initialSelectedId: 1 },
  beforeEach: () => withRole('software-engineer'),
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
    withRole('software-engineer');
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
  beforeEach: () => withRole('software-engineer'),
};
