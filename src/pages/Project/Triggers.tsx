import { useState, useEffect } from "react";
import { Zap, CheckCircle2, Bot, FileText, Activity, Bell, ArrowUpDown, ArrowLeft, Trash2, PlayCircle, PauseCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proxyFetchGet } from "@/api/http";
import { proxyActivateTrigger, proxyDeleteTrigger } from "@/service/triggerApi";
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
import { useActivityLogStore, ActivityType } from "@/store/activityLogStore";
import { Trigger, TriggerInput, TriggerStatus } from "@/types";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

// Helper function to get icon for activity type
const getActivityIcon = (activityType: ActivityType) => {
    switch (activityType) {
        case ActivityType.TriggerCreated:
        case ActivityType.TriggerUpdated:
            return Zap;
        case ActivityType.TriggerDeleted:
            return Trash2;
        case ActivityType.TriggerActivated:
            return PlayCircle;
        case ActivityType.TriggerDeactivated:
            return PauseCircle;
        case ActivityType.ExecutionSuccess:
        case ActivityType.TaskCompleted:
            return CheckCircle2;
        case ActivityType.ExecutionFailed:
            return XCircle;
        case ActivityType.WebhookTriggered:
        case ActivityType.TriggerExecuted:
            return Activity;
        case ActivityType.AgentStarted:
            return Bot;
        case ActivityType.FileGenerated:
            return FileText;
        default:
            return Bell;
    }
};

// Helper function to get type for activity (for styling)
const getActivityNotificationType = (activityType: ActivityType): string => {
    switch (activityType) {
        case ActivityType.ExecutionSuccess:
        case ActivityType.TaskCompleted:
        case ActivityType.TriggerCreated:
        case ActivityType.TriggerActivated:
            return "success";
        case ActivityType.ExecutionFailed:
        case ActivityType.TriggerDeleted:
            return "error";
        case ActivityType.TriggerDeactivated:
            return "warning";
        default:
            return "info";
    }
};

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
    const { triggers, deleteTrigger, duplicateTrigger, updateTrigger, addTrigger, setTriggers } = useTriggerStore();
    
    // Use activity log store
    const { logs: activityLogs, addLog } = useActivityLogStore();

    // Fetch triggers from API on mount
    useEffect(() => {
        const fetchTriggers = async () => {
            try {
                const response = await proxyFetchGet('/api/trigger');
                console.log('Fetched triggers:', response);

                setTriggers(response.items || []);
            } catch (error) {
                console.error('Failed to fetch triggers:', error);
                toast.error('Failed to load triggers');
            }
        };
        
        fetchTriggers();
    }, []);

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

    const handleToggleActive = async (trigger: Trigger) => {
        const newStatus = trigger.status === TriggerStatus.Active ? TriggerStatus.Inactive : TriggerStatus.Active;
        try {
            const response = await proxyActivateTrigger(trigger.id);
            console.log("Trigger activation response:", response);

            updateTrigger(trigger.id, { status: newStatus });
            const isActivating = newStatus === TriggerStatus.Active;
            toast.success(isActivating ? "Trigger activated" : "Trigger paused");
            
            // Add activity log
            addLog({
                type: isActivating ? ActivityType.TriggerActivated : ActivityType.TriggerDeactivated,
                message: `Trigger "${trigger.name}" ${isActivating ? 'activated' : 'deactivated'}`,
                triggerId: trigger.id,
                triggerName: trigger.name,
            });
        } catch(error) {
            console.error("Failed to update trigger status:", error);
            toast.error("Failed to update trigger status");
            return;
        }
    };

    const handleEdit = (trigger: Trigger) => {
        setEditingTrigger(trigger);
        setEditDialogOpen(true);
    };

    const handleDelete = async (triggerId: number) => {
        const trigger = triggers.find(t => t.id === triggerId);
        const triggerName = trigger?.name || 'Unknown';
        
        if (window.confirm(`Are you sure you want to delete "${triggerName}"? This action cannot be undone.`)) {
            try {
                const response = await proxyDeleteTrigger(triggerId);
                console.debug("Trigger deletion response:", response);
                
                deleteTrigger(triggerId);
                if (selectedTriggerId === triggerId) {
                    setSelectedTriggerId(null);
                }
                
                // Add activity log
                addLog({
                    type: ActivityType.TriggerDeleted,
                    message: `Trigger "${triggerName}" deleted`,
                    triggerId: triggerId,
                    triggerName: triggerName,
                });
                
                toast.success("Trigger deleted successfully");
            } catch (error) {
                console.error("Failed to delete trigger:", error);
                toast.error("Failed to delete trigger");
                return;
            }
        }
    };

    const handleDuplicate = (triggerId: number) => {
        const duplicated = duplicateTrigger(triggerId);
        if (duplicated) {
            // Add activity log
            addLog({
                type: ActivityType.TriggerCreated,
                message: `Trigger "${duplicated.name}" created (duplicated)`,
                triggerId: duplicated.id,
                triggerName: duplicated.name,
            });
            
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
                max_executions_per_hour: triggerData.max_executions_per_hour,
                max_executions_per_day: triggerData.max_executions_per_day,
                is_single_execution: triggerData.is_single_execution,
            });
            
            // Add activity log
            addLog({
                type: ActivityType.TriggerUpdated,
                message: `Trigger "${triggerData.name}" updated`,
                triggerId: editingTrigger.id,
                triggerName: triggerData.name,
            });
            
            toast.success("Trigger updated successfully");
        } else {
            // Add new trigger via store
            const newTrigger = addTrigger(triggerData);
            
            // Add activity log
            addLog({
                type: ActivityType.TriggerCreated,
                message: `Trigger "${triggerData.name}" created`,
                triggerId: newTrigger.id,
                triggerName: triggerData.name,
            });
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
                                {activityLogs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                                        <Bell className="w-10 h-10 text-text-label mb-2" />
                                        <p className="text-text-label text-xs">No activity yet</p>
                                        <p className="text-text-label text-xs mt-1">Activity will appear here</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border-tertiary">
                                        {activityLogs.slice(0, 50).map((log, index) => {
                                            const Icon = getActivityIcon(log.type);
                                            const notificationType = getActivityNotificationType(log.type);
                                            const timeAgo = formatDistanceToNow(log.timestamp, { addSuffix: true });
                                            
                                            return (
                                                <div
                                                    key={log.id}
                                                    className={`flex items-center gap-2.5 px-4 py-2 border-l-2 transition-all duration-300 hover:bg-surface-tertiary-hover ${getNotificationStyles(notificationType)}`}
                                                    style={{ animationDelay: `${index * 50}ms` }}
                                                >
                                                    <Icon className={`h-4 w-4 flex-shrink-0 ${getNotificationIconColor(notificationType)}`} />
                                                    <div className="flex flex-col w-full min-w-0">
                                                        <span className="text-label-xs text-text-body leading-relaxed">
                                                            {log.message}
                                                        </span>
                                                        <span className="text-label-xs text-text-label">
                                                            {timeAgo}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
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

