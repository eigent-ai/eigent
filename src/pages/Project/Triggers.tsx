import { useState, useEffect } from "react";
import { Zap, CheckCircle2, Bot, FileText, Activity, Bell, ArrowUpDown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExecutionLogs } from "@/components/Trigger/ExecutionLogs";
import { TriggerDialog } from "@/components/Trigger/TriggerDialog";
import { TriggerListItem } from "@/components/Trigger/TriggerListItem";
import { usePageTabStore } from "@/store/pageTabStore";
import { useTriggerStore } from "@/store/triggerStore";
import { Trigger, TriggerInput, TriggerType, TriggerStatus } from "@/types";
import { mockExecutions } from "@/mocks/triggerMockData";
import { toast } from "sonner";

// Mock notifications data for the live stream
const liveNotifications = [
    {
        id: 1,
        type: "success",
        message: "Task 'API Integration' completed successfully",
        timestamp: "Just now",
        icon: CheckCircle2
    },
    {
        id: 2,
        type: "info",
        message: "Agent 'DataProcessor' started new task",
        timestamp: "2 min ago",
        icon: Bot
    },
    {
        id: 3,
        type: "warning",
        message: "Trigger 'Daily Report' scheduled for 6:00 PM",
        timestamp: "5 min ago",
        icon: Zap
    },
    {
        id: 4,
        type: "info",
        message: "New file 'analysis_v2.pdf' generated",
        timestamp: "12 min ago",
        icon: FileText
    },
    {
        id: 5,
        type: "success",
        message: "Database sync completed",
        timestamp: "15 min ago",
        icon: Activity
    }
];

const getNotificationStyles = (type: string) => {
    switch (type) {
        case "success":
            return "border-l-emerald-500 bg-emerald-500/5";
        case "warning":
            return "border-l-amber-500 bg-amber-500/5";
        case "error":
            return "border-l-red-500 bg-red-500/5";
        default:
            return "border-l-blue-500 bg-blue-500/5";
    }
};

const getNotificationIconColor = (type: string) => {
    switch (type) {
        case "success":
            return "text-emerald-500";
        case "warning":
            return "text-amber-500";
        case "error":
            return "text-red-500";
        default:
            return "text-blue-500";
    }
};

export default function Overview() {
    const [sortBy, setSortBy] = useState<"createdAt" | "lastExecutionTime" | "tokens">("createdAt");
    const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
    const { setHasTriggers } = usePageTabStore();

    // Use trigger store
    const { triggers, deleteTrigger, duplicateTrigger, updateTrigger, addTrigger } = useTriggerStore();

    // Update hasTriggers based on the trigger list
    useEffect(() => {
        setHasTriggers(triggers.length > 0);
    }, [triggers, setHasTriggers]);

    // Sort triggers directly
    const sortedTriggers = [...triggers].sort((a, b) => {
        switch (sortBy) {
            case "createdAt":
                return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
            case "lastExecutionTime":
                return new Date(b.last_executed_at || 0).getTime() - new Date(a.last_executed_at || 0).getTime();
            case "tokens":
                // For now, sort by execution count as proxy for token usage
                return (b.execution_count || 0) - (a.execution_count || 0);
            default:
                return 0;
        }
    });

    const getSortLabel = () => {
        switch (sortBy) {
            case "createdAt":
                return "Created Time";
            case "lastExecutionTime":
                return "Last Execution";
            case "tokens":
                return "Token Cost";
        }
    };

    const handleToggleActive = (trigger: Trigger) => {
        const newStatus = trigger.status === TriggerStatus.Active ? TriggerStatus.Inactive : TriggerStatus.Active;
        updateTrigger(trigger.id, { status: newStatus });
        toast.success(newStatus === TriggerStatus.Active ? "Trigger activated" : "Trigger paused");
    };

    const handleEdit = (trigger: Trigger) => {
        setEditingTrigger(trigger);
        setEditDialogOpen(true);
    };

    const handleDelete = (triggerId: number) => {
        if (window.confirm("Are you sure you want to delete this trigger?")) {
            deleteTrigger(triggerId);
            if (selectedTriggerId === triggerId) {
                setSelectedTriggerId(null);
            }
            toast.success("Trigger deleted successfully");
        }
    };

    const handleDuplicate = (triggerId: number) => {
        const duplicated = duplicateTrigger(triggerId);
        if (duplicated) {
            toast.success(`Trigger duplicated as "${duplicated.name}"`);
        }
    };

    const handleTriggerCreated = (triggerData: TriggerInput) => {
        if (editingTrigger) {
            // Update existing trigger
            updateTrigger(editingTrigger.id, {
                name: triggerData.name,
                description: triggerData.description,
                trigger_type: triggerData.trigger_type,
                custom_cron_expression: triggerData.custom_cron_expression,
                webhook_url: triggerData.webhook_url,
                listener_type: triggerData.listener_type,
                task_prompt: triggerData.task_prompt,
                agent_model: triggerData.agent_model,
                system_message: triggerData.system_message,
                max_executions_per_hour: triggerData.max_executions_per_hour,
                max_executions_per_day: triggerData.max_executions_per_day,
                is_single_execution: triggerData.is_single_execution,
            });
            toast.success("Trigger updated successfully");
        } else {
            // Add new trigger via store
            addTrigger(triggerData);
        }
        setEditingTrigger(null);
    };

    const handleDialogClose = (open: boolean) => {
        setEditDialogOpen(open);
        if (!open) {
            setEditingTrigger(null);
        }
    };

    return (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full">
            <div className="flex flex-row h-full bg-surface-secondary pt-2 px-2 gap-2">
                {/* Left Side: Trigger List (2/3 width) */}
                <div className="flex w-2/3 flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 mb-4 mt-2">
                        <div className="text-body-sm font-bold text-text-heading">Triggers</div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <div className="flex items-center gap-2">
                                    <span className="text-label-sm text-text-label">{getSortLabel()}</span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <ArrowUpDown className="h-4 w-4" />
                                    </Button>
                                </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setSortBy("createdAt")}>
                                    Created Time
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy("lastExecutionTime")}>
                                    Last Execution
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy("tokens")}>
                                    Token Cost
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* List View Section */}
                    <div className="flex flex-col h-full pl-3 pr-0.5 overflow-auto scrollbar">
                        <div className="space-y-3">
                            {sortedTriggers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <Zap className="w-12 h-12 text-text-label mb-3" />
                                    <p className="text-text-label text-sm">No triggers yet</p>
                                    <p className="text-text-label text-xs mt-1">Create a trigger to automate your tasks</p>
                                </div>
                            ) : (
                                sortedTriggers.map((trigger) => (
                                    <TriggerListItem
                                        key={trigger.id}
                                        trigger={trigger}
                                        isSelected={selectedTriggerId === trigger.id}
                                        onSelect={setSelectedTriggerId}
                                        onEdit={handleEdit}
                                        onDuplicate={handleDuplicate}
                                        onDelete={handleDelete}
                                        onToggleActive={handleToggleActive}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Side: Live Activity or Execution Logs (1/3 width) */}
                <div className="w-1/3 flex flex-col bg-surface-tertiary rounded-xl border border-border-tertiary overflow-hidden mb-2">
                    {selectedTriggerId ? (
                        <>
                            {/* Back button to return to Live Activity */}
                            <div className="flex items-center px-3 py-2 bg-surface-tertiary relative">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedTriggerId(null)}
                                >
                                    <ArrowLeft />
                                </Button>
                                <span className="absolute left-1/2 -translate-x-1/2 text-text-body font-bold text-body-sm">Execution Logs</span>
                            </div>
                            <div className="flex-1 min-h-0">
                                <ExecutionLogs triggerId={selectedTriggerId} />
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Live Activity Header */}
                            <div className="flex items-center justify-between p-4 border-b border-border-tertiary">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex item-center">
                                        <Bell className="h-4 w-4 text-text-action" />
                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                    </div>
                                    <span className="text-label-sm font-bold text-text-heading">
                                        Live Activity
                                    </span>
                                </div>
                            </div>
                            {/* Live Activity Content */}
                            <div className="flex-1 overflow-y-auto scrollbar">
                                <div className="divide-y divide-border-tertiary">
                                    {liveNotifications.map((notification, index) => (
                                        <div
                                            key={notification.id}
                                            className={`flex items-center gap-2.5 px-4 py-2 border-l-2 transition-all duration-300 hover:bg-surface-tertiary-hover ${getNotificationStyles(notification.type)}`}
                                            style={{ animationDelay: `${index * 100}ms` }}
                                        >
                                            <notification.icon className={`h-4 w-4 flex-shrink-0 ${getNotificationIconColor(notification.type)}`} />
                                            <div className="flex flex-col w-full min-w-0">
                                                <span className="text-label-xs text-text-body leading-relaxed">
                                                    {notification.message}
                                                </span>
                                                <span className="text-label-xs text-text-label">
                                                    {notification.timestamp}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Edit Trigger Dialog */}
            <TriggerDialog
                view="create"
                selectedTrigger={editingTrigger}
                isOpen={editDialogOpen}
                onOpenChange={handleDialogClose}
                onTriggerCreating={() => { }}
                onTriggerCreated={handleTriggerCreated}
            />
        </div>
    );
}

