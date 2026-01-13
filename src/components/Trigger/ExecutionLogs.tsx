import { CheckCircle2, XCircle, Clock, Play, AlertTriangle, Terminal, ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { proxyFetchTrigger, proxyFetchTriggerExecutions } from "@/service/triggerApi";
import { useActivityLogStore, ActivityType } from "@/store/activityLogStore";
import { Trigger, TriggerExecution, ExecutionStatus } from "@/types";

export interface ExecutionLogEntry {
    id: number;
    timestamp: string;
    status: "success" | "error" | "running" | "pending" | "cancelled";
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
const mapExecutionStatus = (status: ExecutionStatus): ExecutionLogEntry["status"] => {
    switch (status) {
        case ExecutionStatus.Completed:
            return "success";
        case ExecutionStatus.Failed:
            return "error";
        case ExecutionStatus.Running:
            return "running";
        case ExecutionStatus.Pending:
            return "pending";
        case ExecutionStatus.Cancelled:
            return "cancelled";
        case ExecutionStatus.Missed:
            return "error";
        default:
            return "pending";
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

// Helper function to format relative time
const formatRelativeTime = (dateString?: string): string => {
    if (!dateString) return "Never";
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
};

// Helper function to format timestamp
const formatTimestamp = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
    });
};

// Helper function to transform TriggerExecution to ExecutionLogEntry
const transformToLogEntry = (execution: TriggerExecution): ExecutionLogEntry => {
    const status = mapExecutionStatus(execution.status);
    const duration = formatDuration(execution.duration_seconds);
    
    let message = "";
    switch (execution.status) {
        case ExecutionStatus.Completed:
            message = "Execution completed successfully";
            break;
        case ExecutionStatus.Failed:
            message = execution.error_message || "Execution failed";
            break;
        case ExecutionStatus.Running:
            message = "Execution in progress...";
            break;
        case ExecutionStatus.Pending:
            message = "Waiting to execute...";
            break;
        case ExecutionStatus.Cancelled:
            message = "Execution was cancelled";
            break;
        case ExecutionStatus.Missed:
            message = "Execution was missed";
            break;
        default:
            message = "Unknown status";
    }
    
    const details = execution.error_message && execution.status === ExecutionStatus.Failed 
        ? execution.error_message 
        : undefined;
    
    return {
        id: execution.id,
        timestamp: formatTimestamp(execution.started_at || execution.created_at || new Date().toISOString()),
        status,
        message,
        duration,
        details
    };
};

const getStatusIcon = (status: ExecutionLogEntry["status"]) => {
    switch (status) {
        case "success":
            return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
        case "error":
            return <XCircle className="h-3.5 w-3.5 text-red-500" />;
        case "running":
            return <Play className="h-3.5 w-3.5 text-blue-500 animate-pulse" />;
        case "pending":
            return <Clock className="h-3.5 w-3.5 text-amber-500" />;
        case "cancelled":
            return <XCircle className="h-3.5 w-3.5 text-gray-500" />;
        default:
            return <AlertTriangle className="h-3.5 w-3.5 text-gray-500" />;
    }
};

const getStatusColor = (status: ExecutionLogEntry["status"]) => {
    switch (status) {
        case "success":
            return "border-l-emerald-500";
        case "error":
            return "border-l-red-500";
        case "running":
            return "border-l-blue-500";
        case "pending":
            return "border-l-amber-500";
        case "cancelled":
            return "border-l-gray-500";
        default:
            return "border-l-gray-500";
    }
};

interface ExecutionLogsProps {
    triggerId: number;
}

export function ExecutionLogs({ triggerId }: ExecutionLogsProps) {
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
                const executionsResponse = await proxyFetchTriggerExecutions(triggerId, 1, 50);
                const executionsData = Array.isArray(executionsResponse) 
                    ? executionsResponse 
                    : (Array.isArray(executionsResponse?.items) ? executionsResponse.items : []);
                setExecutions(executionsData);
            } catch (err) {
                console.error("Failed to fetch execution data:", err);
                setError("Failed to load execution data");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [triggerId]);

    // Listen to activity logs for real-time updates
    useEffect(() => {
        const relevantLogs = activityLogs.filter(log => log.triggerId === triggerId);
        
        if (relevantLogs.length > 0) {
            // Refresh execution data when there's a new relevant activity
            const latestLog = relevantLogs[0];
            if ([ActivityType.TriggerExecuted, ActivityType.ExecutionSuccess, ActivityType.ExecutionFailed].includes(latestLog.type)) {
                proxyFetchTriggerExecutions(triggerId, 1, 50)
                    .then(executionsResponse => {
                        const executionsData = Array.isArray(executionsResponse) 
                            ? executionsResponse 
                            : (Array.isArray(executionsResponse?.items) ? executionsResponse.items : []);
                        setExecutions(executionsData);
                    })
                    .catch(err => console.error("Failed to refresh executions:", err));
            }
        }
    }, [activityLogs, triggerId]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-label">
                <Loader2 className="h-8 w-8 mb-2 animate-spin" />
                <span className="text-sm">Loading execution data...</span>
            </div>
        );
    }

    if (error || !trigger) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-label">
                <Terminal className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-sm">{error || "No execution data available"}</span>
            </div>
        );
    }

    // Transform executions to log entries
    const logs = Array.isArray(executions) ? executions.map(transformToLogEntry) : [];

    // Calculate success rate
    const completedExecutions = Array.isArray(executions) ? executions.filter(e => 
        e.status === ExecutionStatus.Completed || e.status === ExecutionStatus.Failed
    ) : [];
    const successfulExecutions = Array.isArray(executions) ? executions.filter(e => e.status === ExecutionStatus.Completed) : [];
    const successRate = completedExecutions.length > 0 
        ? Math.round((successfulExecutions.length / completedExecutions.length) * 100)
        : 0;

    return (
        <div className="flex flex-col h-full">
            {/* Stats */}
            <div className="flex items-center gap-4 px-4 py-3 bg-surface-primary border-b border-border-tertiary">
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Trigger</span>
                    <span className="text-label-sm font-medium text-text-heading truncate max-w-[150px]" title={trigger.name}>
                        {trigger.name}
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Total Runs</span>
                    <span className="text-label-sm font-medium text-text-heading">
                        {trigger.execution_count || 0}
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Success Rate</span>
                    <span className={`text-label-sm font-medium ${successRate >= 90 ? 'text-emerald-600' : successRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                        {successRate}%
                    </span>
                </div>
            </div>

            {/* Log Entries */}
            <div className="flex-1 overflow-y-auto scrollbar">
                {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-label py-8">
                        <Terminal className="h-8 w-8 mb-2 opacity-50" />
                        <span className="text-sm">No executions yet</span>
                    </div>
                ) : (
                    <div className="divide-y divide-border-tertiary">
                        {logs.map((log) => (
                            <div
                                key={log.id}
                                className={`flex items-start gap-2.5 px-4 py-2.5 border-l-2 hover:bg-surface-tertiary-hover transition-colors ${getStatusColor(log.status)}`}
                            >
                                <div className="flex-shrink-0 mt-0.5">
                                    {getStatusIcon(log.status)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-label-xs font-mono text-text-label">
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
                                    <p className="text-label-xs text-text-body mt-0.5">
                                        {log.message}
                                    </p>
                                    {log.details && (
                                        <p className="text-label-xs text-text-label mt-0.5 font-mono">
                                            {log.details}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border-tertiary bg-surface-primary">
                <span className="text-label-xs text-text-label">
                    Last run: {formatRelativeTime(trigger.last_executed_at)}
                </span>
            </div>
        </div>
    );
}
