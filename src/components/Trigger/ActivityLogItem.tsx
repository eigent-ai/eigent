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

import { formatRelativeTime } from '@/lib/utils';
import { ActivityLog, ActivityType } from '@/store/activityLogStore';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  Clock,
  Globe,
  PlayCircle,
  Trash2,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlarmClockIcon } from '../animate-ui/icons/alarm-clock';

// Helper function to get status icon for activity type (left side status lead)
const getStatusIcon = (activityType: ActivityType) => {
  switch (activityType) {
    case ActivityType.TriggerCreated:
    case ActivityType.TriggerUpdated:
    case ActivityType.TriggerActivated:
      return Zap; // trigger created
    case ActivityType.TriggerDeleted:
    case ActivityType.TriggerDeactivated:
      return Trash2; // trigger deleted
    case ActivityType.TriggerExecuted:
    case ActivityType.ExecutionSuccess:
    case ActivityType.TaskCompleted:
    case ActivityType.AgentStarted:
      return PlayCircle; // trigger executed
    case ActivityType.ExecutionCancelled:
      return Clock; // cancelled
    case ActivityType.ExecutionFailed:
      return AlertTriangle; // alert/error
    case ActivityType.WebhookTriggered:
      return Activity;
    default:
      return Bell;
  }
};

// Helper function to get status state text
const getStatusStateText = (activityType: ActivityType, t: any): string => {
  switch (activityType) {
    case ActivityType.TriggerCreated:
      return t('triggers.status-created');
    case ActivityType.TriggerUpdated:
      return t('triggers.status-updated');
    case ActivityType.TriggerActivated:
      return t('triggers.status-activated');
    case ActivityType.TriggerDeleted:
      return t('triggers.status-deleted');
    case ActivityType.TriggerDeactivated:
      return t('triggers.status-deactivated');
    case ActivityType.TriggerExecuted:
    case ActivityType.AgentStarted:
      return t('triggers.status-execution-started');
    case ActivityType.ExecutionSuccess:
    case ActivityType.TaskCompleted:
      return t('triggers.status-execution-completed');
    case ActivityType.ExecutionCancelled:
      return t('triggers.status-cancelled', 'Cancelled');
    case ActivityType.ExecutionFailed:
      return t('triggers.status-error');
    case ActivityType.WebhookTriggered:
      return t('triggers.status-webhook-triggered');
    default:
      return t('triggers.status-activity');
  }
};

// Helper function to determine if the trigger is schedule or webhook type
const getTriggerTypeFromActivity = (
  activityType: ActivityType
): 'schedule' | 'webhook' => {
  if (activityType === ActivityType.WebhookTriggered) {
    return 'webhook';
  }
  return 'schedule'; // default to schedule
};

// Helper function to get status type (for styling the left status lead icon)
const getStatusType = (
  activityType: ActivityType
): 'info' | 'success' | 'error' => {
  switch (activityType) {
    case ActivityType.ExecutionFailed:
      return 'error';
    case ActivityType.ExecutionSuccess:
    case ActivityType.TaskCompleted:
      return 'success';
    case ActivityType.ExecutionCancelled:
      return 'info';
    default:
      return 'info';
  }
};

// Helper function to get trigger type status (for styling the right trigger type icon)
const getTriggerTypeStatus = (
  activityType: ActivityType
): 'success' | 'error' => {
  switch (activityType) {
    case ActivityType.ExecutionFailed:
    case ActivityType.TriggerDeleted:
      return 'error';
    case ActivityType.ExecutionCancelled:
      return 'success';
    default:
      return 'success';
  }
};

interface ActivityLogItemProps {
  log: ActivityLog;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function ActivityLogItem({
  log,
  index,
  isExpanded,
  onToggleExpanded,
}: ActivityLogItemProps) {
  const { t } = useTranslation();
  const StatusIcon = getStatusIcon(log.type);
  const statusType = getStatusType(log.type);
  const triggerTypeStatus = getTriggerTypeStatus(log.type);
  const triggerType = getTriggerTypeFromActivity(log.type);
  const stateText = getStatusStateText(log.type, t);
  const timeAgo = formatRelativeTime(log.timestamp.toISOString());
  const triggerNumber = log.triggerId ? `#${log.triggerId}` : `#${index + 1}`;

  // Status lead icon styles
  const statusIconBgClass =
    statusType === 'error'
      ? 'bg-surface-cuation'
      : statusType === 'success'
        ? 'bg-surface-success'
        : 'bg-surface-tertiary';
  const statusIconColorClass =
    statusType === 'error'
      ? 'text-icon-cuation'
      : statusType === 'success'
        ? 'text-icon-success'
        : 'text-icon-information';

  // Trigger type icon styles
  const typeIconColorClass =
    triggerTypeStatus === 'error' ? 'text-icon-cuation' : 'text-icon-success';

  const TriggerTypeIcon = triggerType === 'webhook' ? Globe : AlarmClockIcon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="relative flex items-start px-4"
    >
      {/* Left side: Status Lead Icon */}
      <div className="flex flex-col items-center self-stretch">
        <div
          className={`relative flex h-6 w-6 items-center justify-center rounded-full ${statusIconBgClass} flex-shrink-0`}
        >
          <StatusIcon className={`h-4 w-4 ${statusIconColorClass}`} />
        </div>
        <div className="w-[1px] flex-1 bg-border-secondary" />
      </div>

      {/* Right side: Content */}
      <div className="mb-4 flex min-w-0 flex-1 flex-col">
        {/* Top row: Trigger type icon + timestamp */}
        <div className="mb-2 flex items-center justify-between px-1">
          <div
            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center`}
          >
            <TriggerTypeIcon className={`h-4 w-4 ${typeIconColorClass}`} />
          </div>
          <span className="text-label-xs text-text-label">{timeAgo}</span>
        </div>

        {/* Bottom row: Accordion */}
        <div className="flex cursor-pointer flex-col items-center justify-center rounded-md bg-surface-secondary px-2 py-1 transition-colors duration-150 hover:bg-surface-tertiary">
          <button
            onClick={onToggleExpanded}
            className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-0 text-left"
          >
            <div className="flex flex-row gap-2">
              <span className="text-label-sm font-medium text-text-heading">
                {t('triggers.trigger-label')} {triggerNumber}
              </span>
              <span className="text-label-sm font-normal text-text-label">
                {stateText}
              </span>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-text-label opacity-30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Accordion content */}
          <motion.div
            initial={false}
            animate={{
              height: isExpanded ? 'auto' : 0,
              opacity: isExpanded ? 1 : 0,
            }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="min-h-[32px] px-2 py-2">
              {log.metadata && Object.keys(log.metadata).length > 0 ? (
                <div className="space-y-0.5 text-label-sm text-text-label">
                  {Object.entries(log.metadata)
                    .filter(
                      ([, value]) =>
                        value !== undefined && value !== null && value !== ''
                    )
                    .map(([key, value]) => {
                      let displayKey = key
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                      let displayValue: string;
                      if (key === 'tokens_used') {
                        displayKey = 'Tokens Used';
                        displayValue = `${Number(value).toLocaleString()} tokens`;
                      } else if (key === 'duration_seconds') {
                        displayKey = 'Duration';
                        const secs = Number(value);
                        displayValue =
                          secs < 60
                            ? `${secs.toFixed(1)}s`
                            : `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
                      } else if (key === 'status') {
                        return null; // status is redundant — shown in the header
                      } else {
                        displayValue = String(value);
                      }
                      return (
                        <div key={key} className="flex gap-2">
                          <span className="font-medium text-text-secondary">
                            {displayKey}:
                          </span>
                          <span>{displayValue}</span>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-label-xs text-text-disabled">
                  {/* Empty content box */}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
