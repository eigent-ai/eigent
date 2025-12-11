import { CheckCircle2, XCircle, Clock, Play, AlertTriangle, Terminal, ArrowRight } from "lucide-react";

export interface ExecutionLogEntry {
    id: number;
    timestamp: string;
    status: "success" | "error" | "running" | "pending";
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

// Mock execution logs data
export const mockExecutionLogs: Record<number, TriggerExecutionData> = {
    1: {
        triggerId: 1,
        triggerName: "API Integration Complete",
        lastRun: "2 hours ago",
        totalRuns: 45,
        successRate: 98,
        logs: [
            { id: 1, timestamp: "10:45:23", status: "success", message: "Execution completed successfully", duration: "1.2s" },
            { id: 2, timestamp: "10:45:22", status: "success", message: "API response received", duration: "0.8s" },
            { id: 3, timestamp: "10:45:21", status: "running", message: "Sending request to payment gateway..." },
            { id: 4, timestamp: "10:45:20", status: "success", message: "Authentication token validated", duration: "0.3s" },
            { id: 5, timestamp: "10:45:19", status: "success", message: "Trigger initiated", duration: "0.1s" },
        ]
    },
    2: {
        triggerId: 2,
        triggerName: "Database Migration",
        lastRun: "4 hours ago",
        totalRuns: 12,
        successRate: 83,
        logs: [
            { id: 1, timestamp: "08:30:45", status: "running", message: "Migration in progress...", details: "Processing table users_v2" },
            { id: 2, timestamp: "08:30:30", status: "success", message: "Schema validation passed", duration: "2.1s" },
            { id: 3, timestamp: "08:30:15", status: "success", message: "Backup created", duration: "5.4s" },
            { id: 4, timestamp: "08:30:10", status: "success", message: "Connection established", duration: "0.2s" },
        ]
    },
    3: {
        triggerId: 3,
        triggerName: "UI Component Library",
        lastRun: "Yesterday",
        totalRuns: 28,
        successRate: 100,
        logs: [
            { id: 1, timestamp: "18:22:10", status: "success", message: "Build completed", duration: "12.3s" },
            { id: 2, timestamp: "18:22:05", status: "success", message: "Tests passed (24/24)", duration: "8.1s" },
            { id: 3, timestamp: "18:21:55", status: "success", message: "Linting passed", duration: "3.2s" },
            { id: 4, timestamp: "18:21:50", status: "success", message: "Dependencies resolved", duration: "1.8s" },
        ]
    },
    4: {
        triggerId: 4,
        triggerName: "Performance Optimization",
        lastRun: "Yesterday",
        totalRuns: 8,
        successRate: 75,
        logs: [
            { id: 1, timestamp: "14:15:30", status: "error", message: "Query timeout exceeded", details: "Max timeout: 30s" },
            { id: 2, timestamp: "14:15:00", status: "running", message: "Optimizing query batch #3..." },
            { id: 3, timestamp: "14:14:45", status: "success", message: "Query batch #2 optimized", duration: "15.2s" },
            { id: 4, timestamp: "14:14:30", status: "success", message: "Query batch #1 optimized", duration: "8.7s" },
        ]
    },
    5: {
        triggerId: 5,
        triggerName: "Team Onboarding",
        lastRun: "2 days ago",
        totalRuns: 156,
        successRate: 99,
        logs: [
            { id: 1, timestamp: "09:00:15", status: "success", message: "Onboarding completed", duration: "45.2s" },
            { id: 2, timestamp: "09:00:10", status: "success", message: "Access permissions granted", duration: "2.1s" },
            { id: 3, timestamp: "09:00:05", status: "success", message: "Welcome email sent", duration: "1.5s" },
            { id: 4, timestamp: "09:00:01", status: "success", message: "User account created", duration: "3.2s" },
        ]
    },
    6: {
        triggerId: 6,
        triggerName: "Sprint Planning",
        lastRun: "3 days ago",
        totalRuns: 4,
        successRate: 100,
        logs: [
            { id: 1, timestamp: "11:30:00", status: "pending", message: "Awaiting team input..." },
            { id: 2, timestamp: "11:29:55", status: "success", message: "Tasks allocated to team members", duration: "0.5s" },
            { id: 3, timestamp: "11:29:50", status: "success", message: "Sprint backlog created", duration: "1.2s" },
        ]
    }
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
        default:
            return "border-l-gray-500";
    }
};

interface ExecutionLogsProps {
    triggerId: number;
}

export function ExecutionLogs({ triggerId }: ExecutionLogsProps) {
    const executionData = mockExecutionLogs[triggerId];

    if (!executionData) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-label">
                <Terminal className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-sm">No execution data available</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Stats */}
            <div className="flex items-center gap-4 px-4 py-3 bg-surface-primary border-b border-border-tertiary">
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Trigger</span>
                    <span className="text-label-sm font-medium text-text-heading truncate max-w-[150px]">
                        {executionData.triggerName}
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Total Runs</span>
                    <span className="text-label-sm font-medium text-text-heading">
                        {executionData.totalRuns}
                    </span>
                </div>
                <div className="flex flex-col">
                    <span className="text-label-xs text-text-label">Success Rate</span>
                    <span className={`text-label-sm font-medium ${executionData.successRate >= 90 ? 'text-emerald-600' : executionData.successRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                        {executionData.successRate}%
                    </span>
                </div>
            </div>

            {/* Log Entries */}
            <div className="flex-1 overflow-y-auto scrollbar">
                <div className="divide-y divide-border-tertiary">
                    {executionData.logs.map((log) => (
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
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border-tertiary bg-surface-primary">
                <span className="text-label-xs text-text-label">
                    Last run: {executionData.lastRun}
                </span>
            </div>
        </div>
    );
}
