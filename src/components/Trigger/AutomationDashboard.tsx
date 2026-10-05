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

import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Separator } from '@/components/ui/separator';
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
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  FileText,
  Loader2,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatRunTime,
  formatScheduleLabel,
  getNextRun,
  parseCron,
} from './automationSchedule';

function DetailCardHeading({
  id,
  icon,
  children,
}: {
  id: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-ds-12">
      <DsIcon
        icon={icon}
        recipe="detailed"
        aria-hidden
        className="text-ds-ink-muted-default"
      />
      <DsText as="h2" id={id} role="base" weight="semibold">
        {children}
      </DsText>
    </div>
  );
}

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
  [ExecutionStatus.Missed]: 'triggers.detail-not-started',
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
};

export function AutomationDashboard({ trigger }: AutomationDashboardProps) {
  const [executions, setExecutions] = useState<TriggerExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const activityLogs = useActivityLogStore((state) => state.logs);

  // Terminal delivery can update an older log in place while a newer run exists.
  const executionActivityVersion = activityLogs
    .filter(
      (log) =>
        log.triggerId === trigger.id &&
        [
          ActivityType.TriggerExecuted,
          ActivityType.ExecutionSuccess,
          ActivityType.ExecutionFailed,
          ActivityType.ExecutionCancelled,
        ].includes(log.type)
    )
    .map((log) => `${log.id}:${log.type}`)
    .join('|');

  useEffect(() => {
    let current = true;
    setLoading(true);
    const loadExecutions = async () => {
      try {
        const response = await proxyFetchTriggerExecutions(trigger.id, 1, 50);
        if (!current) return;
        setExecutions(toExecutionList(response));
        setLoadError(false);
      } catch (error) {
        if (!current) return;
        console.error('Failed to fetch execution data:', error);
        setLoadError(true);
      } finally {
        if (current) setLoading(false);
      }
    };
    void loadExecutions();
    return () => {
      current = false;
    };
  }, [executionActivityVersion, trigger.id]);

  return (
    <AutomationDashboardView
      trigger={trigger}
      executions={executions}
      loading={loading}
      loadError={loadError}
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
}: AutomationDashboardViewProps) {
  const { t, i18n } = useTranslation();
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const needsAuth =
    trigger.status === TriggerStatus.PendingAuth &&
    trigger.config?.authentication_required;

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

  const isScheduled = trigger.trigger_type === TriggerType.Schedule;
  const nextRun = isActive && isScheduled ? getNextRun(trigger) : null;
  const schedule = parseCron(trigger.custom_cron_expression);
  const scheduleLabel = schedule
    ? formatScheduleLabel(schedule, t, i18n.language)
    : trigger.custom_cron_expression || t('triggers.schedule-trigger');
  const instructions =
    trigger.task_prompt ||
    (trigger.custom_task
      ? JSON.stringify(trigger.custom_task, null, 2)
      : t('triggers.no-task-prompt'));

  const runMessage = (run: TriggerExecution): string | undefined => {
    switch (run.status) {
      case ExecutionStatus.Failed:
        return run.error_message
          ? errorCopy(errorPresentationReason(run.error_message))
          : t('triggers.execution-failed-message');
      case ExecutionStatus.Missed:
        return run.skip_reason?.message || t('triggers.execution-missed');
      case ExecutionStatus.Cancelled:
        return t('triggers.execution-cancelled');
      default:
        return undefined;
    }
  };

  return (
    <div className="flex w-full flex-col gap-ds-24 py-ds-24">
      <div className="flex flex-col gap-ds-8">
        <div className="flex flex-wrap items-center gap-ds-12">
          <DsText
            as="h1"
            role="page"
            weight="semibold"
            className="min-w-0 break-words"
          >
            {trigger.name}
          </DsText>
          <Tag
            size="xs"
            tone={isActive ? 'success' : 'neutral'}
            emphasis="default"
          >
            {needsAuth
              ? t('triggers.verification-required')
              : isActive
                ? t('triggers.status.active')
                : t('triggers.paused')}
          </Tag>
        </div>
        {trigger.description && (
          <DsText
            as="p"
            role="base"
            className="break-words text-ds-ink-muted-default"
          >
            {trigger.description}
          </DsText>
        )}
      </div>
      <div className="grid grid-cols-1 gap-ds-12 xl:grid-cols-[1fr_2fr]">
        <section
          aria-labelledby="automation-schedule-title"
          className="flex min-w-0 flex-col items-start gap-ds-12 rounded-ds-card bg-ds-neutral-default-default p-ds-card-inset"
        >
          <DetailCardHeading
            id="automation-schedule-title"
            icon={CalendarClock}
          >
            {t('triggers.detail-when')}
          </DetailCardHeading>
          <DsText
            as="p"
            role="section"
            weight="semibold"
            className="break-words tabular-nums"
          >
            {isScheduled
              ? schedule
                ? `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
                : t('triggers.frequency-custom')
              : t(
                  trigger.trigger_type === TriggerType.Webhook
                    ? 'triggers.webhook-trigger'
                    : 'triggers.slack-trigger'
                )}
          </DsText>
          <div className="flex w-full flex-wrap items-baseline gap-x-ds-8 gap-y-ds-4 text-ds-ink-muted-default">
            <DsText as="p" role="base" className="min-w-0 break-words">
              {isScheduled ? scheduleLabel : t('triggers.detail-on-event')}
            </DsText>
            {isScheduled && schedule && (
              <DsText as="span" role="meta" className="whitespace-nowrap">
                {t('triggers.detail-local-time')}
              </DsText>
            )}
          </div>
          {(isScheduled || needsAuth || !isActive) && <Separator />}
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {needsAuth
              ? t('triggers.verification-required')
              : !isActive
                ? t('triggers.detail-paused')
                : nextRun
                  ? t('triggers.next-run-at', {
                      time: formatRunTime(nextRun, i18n.language),
                    })
                  : isScheduled
                    ? t('triggers.no-upcoming-executions')
                    : null}
          </DsText>
        </section>
        <section
          aria-labelledby="automation-instructions-title"
          className="flex min-w-0 flex-col gap-ds-12 rounded-ds-card bg-ds-neutral-default-default p-ds-card-inset"
        >
          <DetailCardHeading id="automation-instructions-title" icon={FileText}>
            {t('triggers.detail-what')}
          </DetailCardHeading>
          <DsText
            as="p"
            role="body-large"
            className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap"
          >
            {instructions}
          </DsText>
        </section>
      </div>
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
        className="flex flex-col gap-ds-8"
      >
        <DsText
          as="h2"
          id="automation-history-title"
          role="body-large"
          weight="semibold"
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
                : t(
                    !isActive
                      ? 'triggers.detail-paused'
                      : isScheduled
                        ? 'triggers.no-upcoming-executions'
                        : 'triggers.detail-on-event'
                  )}
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
                    'py-ds-2 hover:bg-ds-neutral-default-hover',
                    index > 0 &&
                      'border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default'
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={expandedRunId === run.id}
                    aria-controls={`automation-run-${run.id}`}
                    onClick={() =>
                      setExpandedRunId(expandedRunId === run.id ? null : run.id)
                    }
                    className={cn(
                      'flex w-full items-center gap-ds-12 rounded-ds-field p-ds-12 text-left',
                      DS_FOCUS_RING
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
                    <DsIcon
                      icon={
                        expandedRunId === run.id ? ChevronDown : ChevronRight
                      }
                      recipe="main"
                      aria-hidden
                      className="text-ds-ink-muted-default"
                    />
                  </button>
                  {expandedRunId === run.id && (
                    <div
                      id={`automation-run-${run.id}`}
                      className="flex flex-col gap-ds-8 px-ds-12 pb-ds-16"
                    >
                      <DsText
                        as="p"
                        role="base"
                        className="break-words whitespace-pre-wrap text-ds-ink-muted-default"
                      >
                        {message ||
                          t(
                            RUN_LABEL_KEYS[run.status] ??
                              'triggers.unknown-status'
                          )}
                      </DsText>
                      {run.output_data && (
                        <DsText
                          as="pre"
                          channel="code"
                          role="small"
                          className="m-0 [overflow-wrap:anywhere] whitespace-pre-wrap"
                        >
                          {JSON.stringify(run.output_data, null, 2)}
                        </DsText>
                      )}
                      <DsText
                        as="p"
                        role="meta"
                        className="[overflow-wrap:anywhere] text-ds-ink-muted-default"
                      >
                        {t('triggers.execution-id')}: {run.execution_id}
                      </DsText>
                    </div>
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
