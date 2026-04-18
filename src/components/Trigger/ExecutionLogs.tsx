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

import { formatRelativeTime, formatTime } from '@/lib/utils';
import {
  proxyFetchTrigger,
  proxyFetchTriggerExecutions,
} from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { ExecutionStatus, Trigger, TriggerExecution } from '@/types';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ExecutionLogEntry {
  id: number;
  timestamp: string;
  status: 'success' | 'error' | 'running' | 'pending' | 'cancelled';
  message: string;
  duration?: string;
  details?: string;
}

export interface TriggerExecutionData {
  triggerId: number;
  triggerName: string;
  lastRun: string;
  totalRuns: number;
  successRate: number;
  logs: ExecutionLogEntry[];
}

// Success rate thresholds for color coding (percentage)
const SUCCESS_CRITERIA_EXCELLENT = 90;
const SUCCESS_CRITERIA_ACCEPTABLE = 70;

// Helper function to map ExecutionStatus to display status
const mapExecutionStatus = (
  status: ExecutionStatus
): ExecutionLogEntry['status'] => {
  switch (status) {
    case ExecutionStatus.Completed:
      return 'success';
    case ExecutionStatus.Failed:
      return 'error';
    case ExecutionStatus.Running:
      return 'running';
    case ExecutionStatus.Pending:
      return 'pending';
    case ExecutionStatus.Cancelled:
      return 'cancelled';
    case ExecutionStatus.Missed:
      return 'error';
    default:
      return 'pending';
  }
};

// Helper function to format duration
const formatDuration = (seconds?: number): string | undefined => {
  if (!seconds) return undefined;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
};

// Helper function to transform TriggerExecution to ExecutionLogEntry
const transformToLogEntry = (
  execution: TriggerExecution,
  t: any
): ExecutionLogEntry => {
  const status = mapExecutionStatus(execution.status);
  const duration = formatDuration(execution.duration_seconds);

  let message = '';
  switch (execution.status) {
    case ExecutionStatus.Completed:
      message = t('triggers.execution-completed-success');
      break;
    case ExecutionStatus.Failed:
      message =
        execution.error_message || t('triggers.execution-failed-message');
      break;
    case ExecutionStatus.Running:
      message = t('triggers.execution-in-progress');
      break;
    case ExecutionStatus.Pending:
      message = t('triggers.waiting-to-execute');
      break;
    case ExecutionStatus.Cancelled:
      message = t('triggers.execution-cancelled');
      break;
    case ExecutionStatus.Missed:
      message = t('triggers.execution-missed');
      break;
    default:
      message = t('triggers.unknown-status');
  }

  const details =
    execution.error_message && execution.status === ExecutionStatus.Failed
      ? execution.error_message
      : undefined;

  return {
    id: execution.id,
    timestamp: formatTime(execution.started_at || execution.created_at),
    status,
    message,
    duration,
    details,
  };
};

const getStatusIcon = (status: ExecutionLogEntry['status']) => {
  switch (status) {
    case 'success':
      return (
        <CheckCircle2 className="h-3.5 w-3.5 text-ds-icon-status-completed-default-default" />
      );
    case 'error':
      return (
        <XCircle className="h-3.5 w-3.5 text-ds-icon-status-error-default-default" />
      );
    case 'running':
      return (
        <Play className="h-3.5 w-3.5 animate-pulse text-ds-icon-status-running-default-default" />
      );
    case 'pending':
      return (
        <Clock className="h-3.5 w-3.5 text-ds-icon-status-pending-default-default" />
      );
    case 'cancelled':
      return (
        <XCircle className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default" />
      );
    default:
      return (
        <AlertTriangle className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default" />
      );
  }
};

const getStatusColor = (status: ExecutionLogEntry['status']) => {
  switch (status) {
    case 'success':
      return 'border-l-ds-border-status-completed-default-default';
    case 'error':
      return 'border-l-ds-border-status-error-default-default';
    case 'running':
      return 'border-l-ds-border-status-running-default-default';
    case 'pending':
      return 'border-l-ds-border-status-pending-default-default';
    case 'cancelled':
      return 'border-l-ds-border-neutral-muted-default';
    default:
      return 'border-l-ds-border-neutral-muted-default';
  }
};

const getSuccessRateColorClass = (rate: number | null): string => {
  if (rate === null) return 'text-ds-text-neutral-muted-default';
  if (rate >= SUCCESS_CRITERIA_EXCELLENT)
    return 'text-ds-icon-status-completed-default-default';
  if (rate >= SUCCESS_CRITERIA_ACCEPTABLE)
    return 'text-ds-icon-status-pending-default-default';
  return 'text-ds-icon-status-error-default-default';
};

interface ExecutionLogsProps {
  triggerId: number;
}

export function ExecutionLogs({ triggerId }: ExecutionLogsProps) {
  const { t } = useTranslation();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [executions, setExecutions] = useState<TriggerExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { logs: activityLogs } = useActivityLogStore();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch trigger details
        const triggerData = await proxyFetchTrigger(triggerId);
        setTrigger(triggerData);

        // Fetch executions
        const executionsResponse = await proxyFetchTriggerExecutions(
          triggerId,
          1,
          50
        );
        const executionsData = Array.isArray(executionsResponse)
          ? executionsResponse
          : Array.isArray(executionsResponse?.items)
            ? executionsResponse.items
            : [];
        setExecutions(executionsData);
      } catch (err) {
        console.error('Failed to fetch execution data:', err);
        setError(t('triggers.failed-to-load-executions'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [triggerId]);

  // Listen to activity logs for real-time updates
  useEffect(() => {
    const relevantLogs = activityLogs.filter(
      (log) => log.triggerId === triggerId
    );

    if (relevantLogs.length > 0) {
      // Refresh execution data when there's a new relevant activity
      const latestLog = relevantLogs[0];
      if (
        [
          ActivityType.TriggerExecuted,
          ActivityType.ExecutionSuccess,
          ActivityType.ExecutionFailed,
        ].includes(latestLog.type)
      ) {
        proxyFetchTriggerExecutions(triggerId, 1, 50)
          .then((executionsResponse) => {
            const executionsData = Array.isArray(executionsResponse)
              ? executionsResponse
              : Array.isArray(executionsResponse?.items)
                ? executionsResponse.items
                : [];
            setExecutions(executionsData);
          })
          .catch((err) => console.error('Failed to refresh executions:', err));
      }
    }
  }, [activityLogs, triggerId]);

  if (loading) {
    return (
      <div className="text-ds-text-neutral-muted-default flex h-full flex-col items-center justify-center">
        <Loader2 className="mb-2 h-8 w-8 animate-spin" />
        <span className="text-sm">{t('triggers.loading-executions')}</span>
      </div>
    );
  }

  if (error || !trigger) {
    return (
      <div className="text-ds-text-neutral-muted-default flex h-full flex-col items-center justify-center">
        <Terminal className="mb-2 h-8 w-8 opacity-50" />
        <span className="text-sm">
          {error || t('triggers.no-execution-data')}
        </span>
      </div>
    );
  }

  // Transform executions to log entries
  const logs = Array.isArray(executions)
    ? executions.map((e) => transformToLogEntry(e, t))
    : [];

  // Calculate success rate
  const completedExecutions = Array.isArray(executions)
    ? executions.filter(
        (e) =>
          e.status === ExecutionStatus.Completed ||
          e.status === ExecutionStatus.Failed
      )
    : [];
  const successfulExecutions = Array.isArray(executions)
    ? executions.filter((e) => e.status === ExecutionStatus.Completed)
    : [];
  const successRate: number | null =
    completedExecutions.length > 0
      ? Math.round(
          (successfulExecutions.length / completedExecutions.length) * 100
        )
      : null;

  return (
    <div className="flex h-full flex-col">
      {/* Stats */}
      <div className="bg-ds-bg-neutral-strong-default px-4 pb-4 flex flex-col items-start justify-start overflow-hidden">
        <div className="mb-4 flex w-full flex-row items-center justify-between">
          <span
            className="text-label-sm font-medium text-ds-text-neutral-default-default max-w-[150px] truncate"
            title={trigger.name}
          >
            {trigger.name}
          </span>
          <span className="text-label-xs text-ds-text-neutral-muted-default">
            {trigger.trigger_type === 'schedule'
              ? t('triggers.schedule-trigger')
              : trigger.trigger_type === 'webhook'
                ? t('triggers.webhook-trigger')
                : trigger.trigger_type
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
          </span>
        </div>
        <div className="flex flex-row">
          <div className="mr-4 border-ds-border-neutral-subtle-default pr-4 flex flex-col border-y-0 border-r-1 border-l-0 border-solid">
            <span className="text-label-sm font-medium text-ds-text-neutral-default-default">
              {trigger.execution_count || 0}
            </span>
            <span className="text-label-xs text-ds-text-neutral-muted-default">
              {t('triggers.total-runs')}
            </span>
          </div>
          <div className="mr-4 border-ds-border-neutral-subtle-default pr-4 flex flex-col border-y-0 border-r-1 border-l-0 border-solid">
            <span
              className={`text-label-sm font-medium ${getSuccessRateColorClass(successRate)}`}
            >
              {successRate !== null ? `${successRate}%` : '-'}
            </span>
            <span className="text-label-xs text-ds-text-neutral-muted-default">
              {t('triggers.success-rate')}
            </span>
          </div>
        </div>
      </div>

      {/* Log Entries */}
      <div className="scrollbar flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="py-8 text-ds-text-neutral-muted-default flex h-full flex-col items-center justify-center">
            <Terminal className="mb-2 h-8 w-8 opacity-50" />
            <span className="text-sm">{t('triggers.no-executions-yet')}</span>
          </div>
        ) : (
          <div className="divide-ds-border-neutral-subtle-default divide-y">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`hover:bg-ds-bg-neutral-strong-hover gap-2.5 px-4 py-2.5 flex items-start transition-colors ${getStatusColor(log.status)}`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {getStatusIcon(log.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="gap-2 flex items-center">
                    <span className="font-mono text-label-xs text-ds-text-neutral-muted-default">
                      {log.timestamp}
                    </span>
                    {log.duration && (
                      <>
                        <ArrowRight className="h-3 w-3 text-ds-text-neutral-muted-default" />
                        <span className="text-label-xs text-ds-text-neutral-muted-default">
                          {log.duration}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 text-label-xs text-ds-text-neutral-default-default">
                    {log.message}
                  </div>
                  {log.details && (
                    <div className="mt-0.5 font-mono text-label-xs text-ds-text-neutral-muted-default">
                      {log.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 flex flex-row items-center justify-start">
        <span className="text-label-xs text-ds-text-neutral-muted-default">
          {t('triggers.last-run-label')}:{' '}
          {formatRelativeTime(trigger.last_executed_at)}
        </span>
      </div>
    </div>
  );
}
