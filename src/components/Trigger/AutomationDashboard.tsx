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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Tag } from '@/components/ui/tag';
import { errorCopy, errorPresentationReason } from '@/lib/usageErrors';
import { cn } from '@/lib/utils';
import { proxyFetchTriggerExecutions } from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import {
  ExecutionStatus,
  Trigger,
  TriggerExecution,
  TriggerStatus,
  TriggerType,
} from '@/types';
import {
  Ban,
  ChevronLeft,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  Loader2,
  Pencil,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatRunTime,
  formatScheduleLabel,
  formatTimeOfDay,
  getNextRun,
  parseCron,
} from './automationSchedule';

const DEFAULT_MAX_FAILURES = 5;
const WARN_AFTER_FAILURES = 2;
const UNFINISHED_RUN_STATUSES = [
  ExecutionStatus.Failed,
  ExecutionStatus.Missed,
];

type RunStyle = { icon: LucideIcon; iconClass: string; surfaceClass: string };

const RUN_STYLES: Record<ExecutionStatus, RunStyle> = {
  [ExecutionStatus.Completed]: {
    icon: CircleCheck,
    iconClass: 'text-ds-icon-success-default-default',
    surfaceClass: 'bg-ds-bg-success-subtle-default',
  },
  [ExecutionStatus.Failed]: {
    icon: CircleX,
    iconClass: 'text-ds-icon-error-default-default',
    surfaceClass: 'bg-ds-bg-error-subtle-default',
  },
  [ExecutionStatus.Missed]: {
    icon: CirclePause,
    iconClass: 'text-ds-icon-warning-default-default',
    surfaceClass: 'bg-ds-bg-warning-subtle-default',
  },
  [ExecutionStatus.Running]: {
    icon: Loader2,
    iconClass:
      'animate-spin text-ds-icon-information-default-default motion-reduce:animate-none',
    surfaceClass: 'bg-ds-bg-information-subtle-default',
  },
  [ExecutionStatus.Pending]: {
    icon: Clock,
    iconClass: 'text-ds-ink-muted-default',
    surfaceClass: 'bg-ds-neutral-default-default',
  },
  [ExecutionStatus.Cancelled]: {
    icon: Ban,
    iconClass: 'text-ds-ink-muted-default',
    surfaceClass: 'bg-ds-neutral-default-default',
  },
};

const RUN_LABEL_KEYS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.Completed]: 'triggers.completed',
  [ExecutionStatus.Failed]: 'triggers.failed',
  [ExecutionStatus.Missed]: 'triggers.execution-status-missed',
  [ExecutionStatus.Running]: 'triggers.running',
  [ExecutionStatus.Pending]: 'triggers.pending',
  [ExecutionStatus.Cancelled]: 'triggers.status-cancelled',
};

const runTime = (execution: TriggerExecution) =>
  execution.started_at || execution.created_at || '';

const formatDuration = (seconds?: number): string | undefined => {
  if (!seconds) return undefined;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};

const toExecutionList = (response: unknown): TriggerExecution[] => {
  if (Array.isArray(response)) return response;
  const items = (response as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items : [];
};

type AutomationDashboardProps = {
  trigger: Trigger;
  onBack: () => void;
  onEdit: (trigger: Trigger) => void;
};

export function AutomationDashboard({
  trigger,
  onBack,
  onEdit,
}: AutomationDashboardProps) {
  const [executions, setExecutions] = useState<TriggerExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const activityLogs = useActivityLogStore((state) => state.logs);

  const loadExecutions = useCallback(async () => {
    try {
      const response = await proxyFetchTriggerExecutions(trigger.id, 1, 50);
      setExecutions(toExecutionList(response));
      setLoadError(false);
    } catch (error) {
      console.error('Failed to fetch execution data:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [trigger.id]);

  useEffect(() => {
    setLoading(true);
    void loadExecutions();
  }, [loadExecutions]);

  useEffect(() => {
    const latest = activityLogs.find((log) => log.triggerId === trigger.id);
    if (
      latest &&
      [
        ActivityType.TriggerExecuted,
        ActivityType.ExecutionSuccess,
        ActivityType.ExecutionFailed,
      ].includes(latest.type)
    ) {
      void loadExecutions();
    }
  }, [activityLogs, loadExecutions, trigger.id]);

  return (
    <AutomationDashboardView
      trigger={trigger}
      executions={executions}
      loading={loading}
      loadError={loadError}
      onBack={onBack}
      onEdit={onEdit}
    />
  );
}

type AutomationDashboardViewProps = AutomationDashboardProps & {
  executions: TriggerExecution[];
  loading?: boolean;
  loadError?: boolean;
};

export function AutomationDashboardView({
  trigger,
  executions,
  loading = false,
  loadError = false,
  onBack,
  onEdit,
}: AutomationDashboardViewProps) {
  const { t, i18n } = useTranslation();

  const runs = useMemo(
    () =>
      [...executions].sort(
        (a, b) =>
          new Date(runTime(b)).getTime() - new Date(runTime(a)).getTime()
      ),
    [executions]
  );

  const isActive = trigger.status === TriggerStatus.Active;
  const maxFailures =
    Number(trigger.config?.max_failure_count) || DEFAULT_MAX_FAILURES;
  const leadingUnfinished = runs.findIndex(
    (run) => !UNFINISHED_RUN_STATUSES.includes(run.status)
  );
  const consecutiveUnfinished =
    trigger.consecutive_failures ??
    (leadingUnfinished === -1 ? runs.length : leadingUnfinished);

  const finishedRuns = runs.filter((run) =>
    [ExecutionStatus.Completed, ...UNFINISHED_RUN_STATUSES].includes(run.status)
  );
  const successRate =
    finishedRuns.length > 0
      ? Math.round(
          (finishedRuns.filter(
            (run) => run.status === ExecutionStatus.Completed
          ).length /
            finishedRuns.length) *
            100
        )
      : null;

  const nextRun = isActive ? getNextRun(trigger) : null;
  const schedule = parseCron(trigger.custom_cron_expression);
  const subtitle =
    trigger.trigger_type === TriggerType.Schedule
      ? [
          t('triggers.schedule-trigger'),
          schedule && formatScheduleLabel(schedule, t, i18n.language),
        ]
          .filter(Boolean)
          .join(' · ')
      : t('triggers.app-trigger');

  const stats = [
    {
      key: 'total',
      value: String(trigger.execution_count ?? runs.length),
      label: t('triggers.total-runs'),
    },
    {
      key: 'rate',
      value: successRate === null ? '-' : `${successRate}%`,
      label: t('triggers.success-rate'),
    },
    {
      key: 'next',
      value: !isActive
        ? t('triggers.paused')
        : nextRun
          ? formatRunTime(nextRun, i18n.language)
          : '-',
      label: t('triggers.next-run'),
    },
  ];

  const runMessage = (run: TriggerExecution): string | undefined => {
    switch (run.status) {
      case ExecutionStatus.Failed:
        return run.error_message
          ? errorCopy(errorPresentationReason(run.error_message))
          : t('triggers.execution-failed-message');
      case ExecutionStatus.Missed:
        return (
          run.skip_reason?.message ||
          t('triggers.execution-missed-reason', {
            time: formatTimeOfDay(runTime(run)),
          })
        );
      case ExecutionStatus.Cancelled:
        return t('triggers.execution-cancelled');
      default:
        return undefined;
    }
  };

  return (
    <div className="flex w-full flex-col gap-ds-16 py-ds-16">
      <div className="flex items-center gap-ds-8">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft aria-hidden />
          {t('triggers.back-to-examples')}
        </Button>
        <DsText as="span" role="base" weight="semibold" className="flex-1">
          {t('triggers.execution-logs')}
        </DsText>
        <Button variant="outline" size="sm" onClick={() => onEdit(trigger)}>
          <Pencil aria-hidden />
          {t('triggers.edit')}
        </Button>
      </div>

      <div className="flex flex-col gap-ds-4">
        <div className="flex flex-wrap items-center gap-ds-8">
          <DsText as="h2" role="title" weight="semibold" className="min-w-0">
            {trigger.name}
          </DsText>
          <Tag size="xs" tone={isActive ? 'success' : 'neutral'}>
            {isActive
              ? t('triggers.status.active')
              : t('triggers.status.inactive')}
          </Tag>
        </div>
        <DsText as="p" role="base" className="text-ds-ink-muted-default">
          {subtitle}
        </DsText>
      </div>

      <dl className="m-0 grid grid-cols-3 rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
        {stats.map((stat, index) => (
          <div
            key={stat.key}
            className={cn(
              'flex min-w-0 flex-col-reverse gap-ds-2 px-ds-16 py-ds-12',
              index > 0 &&
                'border-x-0 border-y-0 border-l border-solid border-ds-hairline-subtle-default'
            )}
          >
            <dt>
              <DsText
                as="span"
                role="meta"
                className="text-ds-ink-muted-default"
              >
                {stat.label}
              </DsText>
            </dt>
            <dd className="m-0 min-w-0">
              <DsText
                as="span"
                role="body-large"
                weight="semibold"
                className="block truncate tabular-nums"
                title={stat.value}
              >
                {stat.value}
              </DsText>
            </dd>
          </div>
        ))}
      </dl>

      {isActive && consecutiveUnfinished >= WARN_AFTER_FAILURES && (
        <div
          role="status"
          className="flex items-start gap-ds-8 rounded-ds-field bg-ds-bg-warning-subtle-default p-ds-12"
        >
          <DsIcon
            icon={TriangleAlert}
            recipe="main"
            aria-hidden
            className="mt-ds-2 text-ds-icon-warning-default-default"
          />
          <DsText as="p" role="base">
            {t('triggers.consecutive-warning', {
              count: consecutiveUnfinished,
              max: maxFailures,
            })}
          </DsText>
        </div>
      )}

      {!isActive && trigger.auto_disabled_at && (
        <div
          role="status"
          className="flex items-start gap-ds-8 rounded-ds-field bg-ds-bg-warning-subtle-default p-ds-12"
        >
          <DsIcon
            icon={TriangleAlert}
            recipe="main"
            aria-hidden
            className="mt-ds-2 text-ds-icon-warning-default-default"
          />
          <DsText as="p" role="base">
            {t('triggers.auto-disabled-notice', { max: maxFailures })}
          </DsText>
        </div>
      )}

      <section
        aria-labelledby="automation-history-title"
        className="overflow-hidden rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default"
      >
        <DsText
          as="h3"
          id="automation-history-title"
          role="base"
          weight="semibold"
          className="border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-ds-16 py-ds-12"
        >
          {t('triggers.execution-history')}
        </DsText>

        {loading ? (
          <div className="flex items-center justify-center gap-ds-8 px-ds-16 py-ds-40 text-ds-ink-muted-default">
            <DsIcon
              icon={Loader2}
              recipe="main"
              aria-hidden
              className="animate-spin motion-reduce:animate-none"
            />
            <DsText as="span" role="base">
              {t('triggers.loading-executions')}
            </DsText>
          </div>
        ) : loadError ? (
          <DsText
            as="p"
            role="base"
            className="px-ds-16 py-ds-40 text-center text-ds-ink-muted-default"
          >
            {t('triggers.failed-to-load-executions')}
          </DsText>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-ds-4 px-ds-16 py-ds-40 text-center text-ds-ink-muted-default">
            <DsIcon icon={Terminal} recipe="detailed" aria-hidden />
            <DsText as="p" role="base">
              {t('triggers.no-executions-yet')}
            </DsText>
            <DsText as="p" role="meta">
              {nextRun
                ? t('triggers.first-run-on', {
                    time: formatRunTime(nextRun, i18n.language),
                  })
                : t('triggers.turn-on-to-schedule')}
            </DsText>
          </div>
        ) : (
          <ol className="m-0 list-none p-0">
            {runs.map((run, index) => {
              const style = RUN_STYLES[run.status] ?? RUN_STYLES.pending;
              const message = runMessage(run);
              const duration =
                run.status === ExecutionStatus.Completed
                  ? formatDuration(run.duration_seconds)
                  : undefined;
              return (
                <li
                  key={run.id}
                  className={cn(
                    'flex items-start gap-ds-12 px-ds-16 py-ds-12',
                    index > 0 &&
                      'border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-ds-control-xs shrink-0 items-center justify-center rounded-ds-full',
                      style.surfaceClass
                    )}
                  >
                    <DsIcon
                      icon={style.icon}
                      recipe="main-compact"
                      aria-hidden
                      className={style.iconClass}
                    />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-ds-2">
                    <div className="flex flex-wrap items-baseline gap-x-ds-8">
                      <DsText as="span" role="base" weight="semibold">
                        {t(
                          RUN_LABEL_KEYS[run.status] ??
                            'triggers.unknown-status'
                        )}
                      </DsText>
                      <DsText
                        as="span"
                        role="meta"
                        className="text-ds-ink-muted-default tabular-nums"
                      >
                        {formatRunTime(runTime(run), i18n.language)}
                      </DsText>
                    </div>
                    {message && (
                      <DsText
                        as="p"
                        role="base"
                        className="text-ds-ink-muted-default"
                      >
                        {message}
                      </DsText>
                    )}
                  </div>
                  {duration && (
                    <DsText
                      as="span"
                      role="meta"
                      className="shrink-0 text-ds-ink-muted-default tabular-nums"
                    >
                      {duration}
                    </DsText>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
