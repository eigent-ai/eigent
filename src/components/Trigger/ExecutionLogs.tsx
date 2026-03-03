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
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'running':
      return <Play className="h-3.5 w-3.5 animate-pulse text-blue-500" />;
    case 'pending':
      return <Clock className="h-3.5 w-3.5 text-amber-500" />;
    case 'cancelled':
      return <XCircle className="h-3.5 w-3.5 text-gray-500" />;
    default:
      return <AlertTriangle className="h-3.5 w-3.5 text-gray-500" />;
  }
};

const getStatusColor = (status: ExecutionLogEntry['status']) => {
  switch (status) {
    case 'success':
      return 'border-l-emerald-500';
    case 'error':
      return 'border-l-red-500';
    case 'running':
      return 'border-l-blue-500';
    case 'pending':
      return 'border-l-amber-500';
    case 'cancelled':
      return 'border-l-gray-500';
    default:
      return 'border-l-gray-500';
  }
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
      <div className="flex h-full flex-col items-center justify-center text-text-label">
        <Loader2 className="mb-2 h-8 w-8 animate-spin" />
        <span className="text-sm">{t('triggers.loading-executions')}</span>
      </div>
    );
  }

  if (error || !trigger) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-text-label">
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
  const successRate =
    completedExecutions.length > 0
      ? Math.round(
          (successfulExecutions.length / completedExecutions.length) * 100
        )
      : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Stats */}
      <div className="flex flex-col items-start justify-start overflow-hidden bg-surface-tertiary px-4 pb-4">
        <div className="mb-4 flex w-full flex-row items-center justify-between">
          <span
            className="max-w-[150px] truncate text-label-sm font-medium text-text-heading"
            title={trigger.name}
          >
            {trigger.name}
          </span>
          <span className="text-label-xs text-text-label">
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
          <div className="border-r-1 mr-4 flex flex-col border-y-0 border-l-0 border-solid border-border-tertiary pr-4">
            <span className="text-label-sm font-medium text-text-heading">
              {trigger.execution_count || 0}
            </span>
            <span className="text-label-xs text-text-label">
              {t('triggers.total-runs')}
            </span>
          </div>
          <div className="border-r-1 mr-4 flex flex-col border-y-0 border-l-0 border-solid border-border-tertiary pr-4">
            <span
              className={`text-label-sm font-medium ${successRate >= 90 ? 'text-icon-success' : successRate >= 70 ? 'text-icon-warning' : 'text-icon-cuation'}`}
            >
              {successRate}%
            </span>
            <span className="text-label-xs text-text-label">
              {t('triggers.success-rate')}
            </span>
          </div>
        </div>
      </div>

      {/* Log Entries */}
      <div className="scrollbar flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-text-label">
            <Terminal className="mb-2 h-8 w-8 opacity-50" />
            <span className="text-sm">{t('triggers.no-executions-yet')}</span>
          </div>
        ) : (
          <div className="divide-y divide-border-tertiary">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`hover:bg-surface-tertiary-hover flex items-start gap-2.5 px-4 py-2.5 transition-colors ${getStatusColor(log.status)}`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {getStatusIcon(log.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-label-xs text-text-label">
                      {log.timestamp}
                    </span>
                    {log.duration && (
                      <>
                        <ArrowRight className="h-3 w-3 text-text-label" />
                        <span className="text-label-xs text-text-label">
                          {log.duration}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 text-label-xs text-text-body">
                    {log.message}
                  </div>
                  {log.details && (
                    <div className="mt-0.5 font-mono text-label-xs text-text-label">
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
      <div className="flex flex-row items-center justify-start px-4 py-2">
        <span className="text-label-xs text-text-label">
          {t('triggers.last-run-label')}:{' '}
          {formatRelativeTime(trigger.last_executed_at)}
        </span>
      </div>
    </div>
  );
}
