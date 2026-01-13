import { useState, useEffect } from "react";
import { Zap, CheckCircle2, Bot, FileText, Activity, Bell, ArrowUpDown, ArrowLeft, Trash2, PlayCircle, PauseCircle, XCircle, AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogContentSection, DialogFooter } from "@/components/ui/dialog";
import { proxyFetchGet } from "@/api/http";
import { proxyActivateTrigger, proxyDeactivateTrigger, proxyDeleteTrigger, proxyFetchProjectTriggers } from "@/service/triggerApi";
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
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { AnimatePresence, motion } from "framer-motion";

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
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deletingTrigger, setDeletingTrigger] = useState<Trigger | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const { setHasTriggers } = usePageTabStore();

    // Use trigger store
    const { triggers, deleteTrigger, duplicateTrigger, updateTrigger, addTrigger, setTriggers } = useTriggerStore();
    
    // Use activity log store
    const { logs: activityLogs, addLog } = useActivityLogStore();

    //Get projectStore for the active project's task
	const { projectStore } = useChatStoreAdapter();

    // Fetch triggers from API on mount
    useEffect(() => {
        const fetchTriggers = async () => {
            try {
                const response = await proxyFetchProjectTriggers(projectStore.activeProjectId);
                console.log('Fetched triggers:', response);

                setTriggers(response.items || []);
            } catch (error) {
                console.error('Failed to fetch triggers:', error);
                toast.error('Failed to load triggers');
            }
        };
        
        fetchTriggers();
    }, [projectStore.activeProjectId]);

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
        const isActivating = newStatus === TriggerStatus.Active;
        
        try {
            const response = isActivating 
                ? await proxyActivateTrigger(trigger.id)
                : await proxyDeactivateTrigger(trigger.id);
            console.log(`Trigger ${isActivating ? 'activation' : 'deactivation'} response:`, response);

            updateTrigger(trigger.id, { status: newStatus });
            toast.success(isActivating ? "Trigger activated" : "Trigger deactivated");
            
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

    const setSelectedTriggerIdWrapper = (triggerId: number) => {
        //Double Click to Edit
        if(triggerId === selectedTriggerId) {
            handleEdit(triggers.find(t => t.id === triggerId)!);
            return;
        };
        setSelectedTriggerId(triggerId);
    }

    const handleEdit = (trigger: Trigger) => {
        setEditingTrigger(trigger);
        setEditDialogOpen(true);
    };

    const handleDelete = (trigger: Trigger) => {
        setDeletingTrigger(trigger);
        setIsDeleteDialogOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!deletingTrigger) return;
        
        setIsDeleting(true);
        try {
            await proxyDeleteTrigger(deletingTrigger.id);
            deleteTrigger(deletingTrigger.id);
            
            if (selectedTriggerId === deletingTrigger.id) {
                setSelectedTriggerId(null);
            }
            
            // Add activity log
            addLog({
                type: ActivityType.TriggerDeleted,
                message: `Trigger "${deletingTrigger.name}" deleted`,
                triggerId: deletingTrigger.id,
                triggerName: deletingTrigger.name,
            });
            
            toast.success("Trigger deleted successfully");
            setIsDeleteDialogOpen(false);
            setDeletingTrigger(null);
        } catch (error) {
            console.error("Failed to delete trigger:", error);
            toast.error("Failed to delete trigger");
        } finally {
            setIsDeleting(false);
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
            <div className="flex flex-row h-full bg-surface-secondary pt-2 px-2">

                {/* Left Side: Live Activity or Execution Logs (1/3 width) */}
                <div className="flex-[0.3] flex-col bg-surface-primary rounded-xl overflow-hidden mb-2 relative">
                    {/* Live Activity - Always rendered but slides out to the right when logs are shown */}
                    <div 
                        className={`absolute inset-0 flex flex-col bg-surface-primary rounded-xl transition-transform duration-300 ease-in-out ${
                            selectedTriggerId ? 'translate-x-full' : 'translate-x-0'
                        }`}
                    >
                        {/* Live Activity Header */}
                        <div className="flex items-center justify-between h-[52px] pt-2 pb-4 px-4 border-b-[0.5px] border-solid border-t-0 border-x-0 border-border-secondary">
                            <span className="text-label-sm font-bold text-text-heading">
                                Live Activity
                            </span>
                        </div>
                        {/* Live Activity Content */}
                        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-always-visible">
                            {activityLogs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                                    <Bell className="w-10 h-10 text-text-label mb-2" />
                                    <p className="text-text-label text-xs">No activity yet</p>
                                    <p className="text-text-label text-xs mt-1">Activity will appear here</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border-tertiary">
                                    <AnimatePresence initial={false}>
                                        {activityLogs.slice(0, 50).map((log) => {
                                            const Icon = getActivityIcon(log.type);
                                            const notificationType = getActivityNotificationType(log.type);
                                            const timeAgo = formatDistanceToNow(log.timestamp, { addSuffix: true });
                                            
                                            return (
                                                <motion.div
                                                    key={log.id}
                                                    initial={{ opacity: 0, y: -20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -20 }}
                                                    transition={{ duration: 0.2 }}
                                                    className={`flex items-center px-4 py-2 transition-all duration-300 hover:bg-surface-tertiary ${getNotificationStyles(notificationType)}`}
                                                >
                                                    <div className="flex-shrink-0 flex w-full py-1 items-center justify-center gap-2">
                                                    <Icon className={`h-4 w-4 flex-shrink-0 ${getNotificationIconColor(notificationType)}`} />
                                                    <div className="flex flex-row justify-between w-full min-w-0">
                                                        <span className="text-label-xs text-text-body">
                                                            {log.message}
                                                        </span>
                                                        <span className="text-label-xs text-text-label">
                                                            {timeAgo}
                                                        </span>
                                                    </div>
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Execution Logs - Slides in from the left */}
                    <div 
                        className={`absolute inset-0 flex flex-col bg-surface-primary rounded-xl transition-transform duration-300 ease-in-out ${
                            selectedTriggerId ? 'translate-x-0' : '-translate-x-full'
                        }`}
                    >
                        {/* Back button to return to Live Activity */}
                        <div className="flex flex-row items-center justify-start gap-2 px-4 py-3 bg-surface-tertiary relative">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSelectedTriggerId(null)}
                            >
                                <ArrowLeft />
                            </Button>
                            <span className="text-text-body font-bold text-label-sm">
                            Execution Logs
                            </span>
                        </div>
                        <div className="flex-1 min-h-0">
                            {selectedTriggerId && <ExecutionLogs triggerId={selectedTriggerId} />}
                        </div>
                    </div>
                </div>

                {/* Right Side: Trigger List (2/3 width) */}
                <div className="flex-[0.7] flex-col">
                    {/* Header */}
                    <div className="w-full flex items-center justify-between pl-4 pb-4 pt-2">
                        <div className="text-body-sm font-bold text-text-heading">Triggers</div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="sm" className="text-text-label font-semibold text-label-sm">
                                        {getSortLabel()}
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
                    <div className="flex flex-col h-full pl-3 overflow-auto scrollbar-always-visible">
                        <div className="flex flex-col">
                            {sortedTriggers.length === 0 ? (
                                <div
                                    onClick={() => {
                                        setEditingTrigger(null);
                                        setEditDialogOpen(true);
                                    }}
                                    className="group flex items-center justify-center gap-3 p-3 bg-surface-primary rounded-xl border border-border-tertiary hover:border-border-secondary hover:bg-surface-tertiary transition-all duration-200 cursor-pointer"
                                >
                                    {/* Zap Icon */}
                                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-amber-500/10 rounded-lg">
                                        <Plus className="w-5 h-5 text-amber-500" />
                                    </div>

                                    {/* Create Trigger Text */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-text-heading truncate group-hover:text-text-action transition-colors">
                                            Create a trigger to automate your tasks
                                        </div>
                                    </div>

                                    {/* Empty space for alignment */}
                                    <div className="flex items-center gap-1.5 text-xs text-text-label min-w-[80px]"></div>
                                    <div className="flex items-center gap-1.5 text-xs text-text-label min-w-[100px]"></div>
                                    <div className="w-10"></div>
                                    <div className="w-8"></div>
                                </div>
                            ) : (
                                sortedTriggers.map((trigger) => (
                                    <TriggerListItem
                                        key={trigger.id}
                                        trigger={trigger}
                                        isSelected={selectedTriggerId === trigger.id}
                                        onSelect={setSelectedTriggerIdWrapper}
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
            </div>

            {/* Edit Trigger Dialog */}
            <TriggerDialog
                selectedTrigger={editingTrigger}
                isOpen={editDialogOpen}
                onOpenChange={handleDialogClose}
                onTriggerCreating={() => { }}
                onTriggerCreated={handleTriggerCreated}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent
                    size="md"
                    showCloseButton={true}
                    onClose={() => setIsDeleteDialogOpen(false)}
                    className="max-w-[500px]"
                    aria-describedby={undefined}
                >
                    <DialogHeader
                        title="Delete Trigger"
                    />
                    <DialogContentSection className="space-y-4">
                        <p className="text-text-body text-sm">
                            Are you sure you want to delete "{deletingTrigger?.name}"? This action cannot be undone.
                        </p>
                    </DialogContentSection>
                    <DialogFooter>
                        <Button 
                            variant="ghost" 
                            size="md" 
                            onClick={() => setIsDeleteDialogOpen(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button 
                            size="md" 
                            onClick={handleConfirmDelete} 
                            variant="cuation"
                            disabled={isDeleting}
                        >
                            {isDeleting ? "Deleting..." : "Delete Trigger"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

