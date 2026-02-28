import { Zap, Trash2, PlayCircle, AlertTriangle, Bell, Activity, Clock, Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ActivityType, ActivityLog } from "@/store/activityLogStore";
import { formatRelativeTime } from "@/lib/utils";
import { AlarmClockIcon } from "../animate-ui/icons/alarm-clock";

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
            return t("triggers.status-created");
        case ActivityType.TriggerUpdated:
            return t("triggers.status-updated");
        case ActivityType.TriggerActivated:
            return t("triggers.status-activated");
        case ActivityType.TriggerDeleted:
            return t("triggers.status-deleted");
        case ActivityType.TriggerDeactivated:
            return t("triggers.status-deactivated");
        case ActivityType.TriggerExecuted:
        case ActivityType.AgentStarted:
            return t("triggers.status-execution-started");
        case ActivityType.ExecutionSuccess:
        case ActivityType.TaskCompleted:
            return t("triggers.status-execution-completed");
        case ActivityType.ExecutionCancelled:
            return t("triggers.status-cancelled", "Cancelled");
        case ActivityType.ExecutionFailed:
            return t("triggers.status-error");
        case ActivityType.WebhookTriggered:
            return t("triggers.status-webhook-triggered");
        default:
            return t("triggers.status-activity");
    }
};

// Helper function to determine if the trigger is schedule or webhook type
const getTriggerTypeFromActivity = (activityType: ActivityType): 'schedule' | 'webhook' => {
    if (activityType === ActivityType.WebhookTriggered) {
        return 'webhook';
    }
    return 'schedule'; // default to schedule
};

// Helper function to get status type (for styling the left status lead icon)
const getStatusType = (activityType: ActivityType): 'info' | 'success' | 'error' => {
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
const getTriggerTypeStatus = (activityType: ActivityType): 'success' | 'error' => {
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

export function ActivityLogItem({ log, index, isExpanded, onToggleExpanded }: ActivityLogItemProps) {
    const { t } = useTranslation();
    const StatusIcon = getStatusIcon(log.type);
    const statusType = getStatusType(log.type);
    const triggerTypeStatus = getTriggerTypeStatus(log.type);
    const triggerType = getTriggerTypeFromActivity(log.type);
    const stateText = getStatusStateText(log.type, t);
    const timeAgo = formatRelativeTime(log.timestamp.toISOString());
    const triggerNumber = log.triggerId ? `#${log.triggerId}` : `#${index + 1}`;

    // Status lead icon styles
    const statusIconBgClass = statusType === 'error'
        ? 'bg-surface-cuation'
        : statusType === 'success'
            ? 'bg-surface-success'
            : 'bg-surface-tertiary';
    const statusIconColorClass = statusType === 'error'
        ? 'text-icon-cuation'
        : statusType === 'success'
            ? 'text-icon-success'
            : 'text-icon-information';

    // Trigger type icon styles
    const typeIconColorClass = triggerTypeStatus === 'error'
        ? 'text-icon-cuation'
        : 'text-icon-success';

    const TriggerTypeIcon = triggerType === 'webhook' ? Globe : AlarmClockIcon;

    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="flex items-start px-4 relative"
        >

            {/* Left side: Status Lead Icon */}
            <div className="flex flex-col items-center self-stretch">
                <div className={`relative w-6 h-6 rounded-full flex items-center justify-center ${statusIconBgClass} flex-shrink-0`}>
                    <StatusIcon className={`w-4 h-4 ${statusIconColorClass}`} />
                </div>
                <div className="flex-1 w-[1px] bg-border-secondary" />
            </div>

            {/* Right side: Content */}
            <div className="flex flex-col flex-1 min-w-0 mb-4">
                {/* Top row: Trigger type icon + timestamp */}
                <div className="flex items-center justify-between mb-2 px-1">
                    <div className={`flex-shrink-0 w-6 h-6 flex items-center justify-center`}>
                        <TriggerTypeIcon className={`w-4 h-4 ${typeIconColorClass}`} />
                    </div>
                    <span className="text-label-xs text-text-label">
                        {timeAgo}
                    </span>
                </div>

                {/* Bottom row: Accordion */}
                <div className="flex flex-col px-2 py-1 items-center justify-center rounded-md bg-surface-secondary hover:bg-surface-tertiary transition-colors duration-150 cursor-pointer">
                    <button
                        onClick={onToggleExpanded}
                        className="flex items-center justify-between w-full text-left cursor-pointer bg-transparent border-none p-0"
                    >
                        <div className="flex flex-row gap-2">
                            <span className="text-label-sm text-text-heading font-medium">
                                {t('triggers.trigger-label')} {triggerNumber}
                            </span>
                            <span className="text-label-sm text-text-label font-normal">
                                {stateText}
                            </span>
                        </div>
                        <ChevronDown
                            className={`w-4 h-4 text-text-label opacity-30 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                    </button>

                    {/* Accordion content */}
                    <motion.div
                        initial={false}
                        animate={{
                            height: isExpanded ? 'auto' : 0,
                            opacity: isExpanded ? 1 : 0
                        }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-2 py-2 min-h-[32px]">
                            {log.metadata && Object.keys(log.metadata).length > 0 ? (
                                <div className="text-label-sm text-text-label space-y-0.5">
                                    {Object.entries(log.metadata)
                                        .filter(([, value]) => value !== undefined && value !== null && value !== '')
                                        .map(([key, value]) => {
                                            let displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                            let displayValue: string;
                                            if (key === 'tokens_used') {
                                                displayKey = 'Tokens Used';
                                                displayValue = `${Number(value).toLocaleString()} tokens`;
                                            } else if (key === 'duration_seconds') {
                                                displayKey = 'Duration';
                                                const secs = Number(value);
                                                displayValue = secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
                                            } else if (key === 'status') {
                                                return null; // status is redundant — shown in the header
                                            } else {
                                                displayValue = String(value);
                                            }
                                            return (
                                                <div key={key} className="flex gap-2">
                                                    <span className="font-medium text-text-secondary">{displayKey}:</span>
                                                    <span>{displayValue}</span>
                                                </div>
                                            );
                                        })
                                    }
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
