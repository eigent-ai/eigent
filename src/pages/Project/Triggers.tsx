import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ArrowUpDown, ArrowLeft, Plus } from "lucide-react";
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
import { ActivityLogItem } from "@/components/Trigger/ActivityLogItem";
import { usePageTabStore } from "@/store/pageTabStore";
import { useTriggerStore } from "@/store/triggerStore";
import { useActivityLogStore, ActivityType } from "@/store/activityLogStore";
import { Trigger, TriggerInput, TriggerStatus } from "@/types";
import { toast } from "sonner";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { AnimatePresence } from "framer-motion";

export default function Overview() {
    const { t } = useTranslation();
    const [sortBy, setSortBy] = useState<"createdAt" | "lastExecutionTime" | "tokens">("createdAt");
    const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deletingTrigger, setDeletingTrigger] = useState<Trigger | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
    const { setHasTriggers } = usePageTabStore();

    const toggleLogExpanded = (logId: string) => {
        setExpandedLogs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(logId)) {
                newSet.delete(logId);
            } else {
                newSet.add(logId);
            }
            return newSet;
        });
    };

    // Use trigger store
    const { triggers, deleteTrigger, duplicateTrigger, updateTrigger, addTrigger, setTriggers } = useTriggerStore();

    // Get projectStore for the active project's task
    const { projectStore } = useChatStoreAdapter();

    // Use activity log store - subscribe to logs for reactivity
    const { logs: allLogs, addLog } = useActivityLogStore();

    // Get project-specific activity logs using useMemo for performance
    const activityLogs = useMemo(() => {
        if (!projectStore.activeProjectId) return [];
        return allLogs.filter(log => log.projectId === projectStore.activeProjectId).slice(0, 50);
    }, [allLogs, projectStore.activeProjectId]);

    // Fetch triggers from API on mount
    useEffect(() => {
        const fetchTriggers = async () => {
            try {
                const response = await proxyFetchProjectTriggers(projectStore.activeProjectId);
                console.log('Fetched triggers:', response);

                setTriggers(response.items || []);
            } catch (error) {
                console.error('Failed to fetch triggers:', error);
                toast.error(t('triggers.failed-to-load'));
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
                return t('triggers.created-time');
            case "lastExecutionTime":
                return t('triggers.last-execution-label');
            case "tokens":
                return t('triggers.token-cost');
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
            toast.success(isActivating ? t("triggers.activated") : t("triggers.deactivated"));

            // Add activity log
            addLog({
                type: isActivating ? ActivityType.TriggerActivated : ActivityType.TriggerDeactivated,
                message: `Trigger "${trigger.name}" ${isActivating ? 'activated' : 'deactivated'}`,
                projectId: projectStore.activeProjectId || undefined,
                triggerId: trigger.id,
                triggerName: trigger.name,
            });
        } catch (error) {
            console.error("Failed to update trigger status:", error);
            toast.error(t("triggers.failed-to-toggle"));
            return;
        }
    };

    const setSelectedTriggerIdWrapper = (triggerId: number) => {
        //Double Click to Edit
        if (triggerId === selectedTriggerId) {
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
                projectId: projectStore.activeProjectId || undefined,
                triggerId: deletingTrigger.id,
                triggerName: deletingTrigger.name,
            });

            toast.success(t("triggers.deleted"));
            setIsDeleteDialogOpen(false);
            setDeletingTrigger(null);
        } catch (error) {
            console.error("Failed to delete trigger:", error);
            toast.error(t("triggers.failed-to-delete"));
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
                projectId: projectStore.activeProjectId || undefined,
                triggerId: duplicated.id,
                triggerName: duplicated.name,
            });

            toast.success(t('triggers.duplicated-successfully', { name: duplicated.name }));
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
                projectId: projectStore.activeProjectId || undefined,
                triggerId: editingTrigger.id,
                triggerName: triggerData.name,
            });

            toast.success(t("triggers.updated-successfully"));
        } else {
            // Add new trigger via store
            const newTrigger = addTrigger(triggerData);

            // Add activity log
            addLog({
                type: ActivityType.TriggerCreated,
                message: `Trigger "${triggerData.name}" created`,
                projectId: projectStore.activeProjectId || undefined,
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

                {/* Left Side: Trigger List (70% width) */}
                <div className="flex-[0.6] flex flex-col min-w-0">
                    {/* Header */}
                    <div className="w-full flex items-center justify-between pl-4 pb-4 pt-2">
                        <div className="text-body-sm font-bold text-text-heading">{t('triggers.title')}</div>
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
                                    {t('triggers.created-time')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy("lastExecutionTime")}>
                                    {t('triggers.last-execution-label')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy("tokens")}>
                                    {t('triggers.token-cost')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* List View Section */}
                    <div className="flex flex-col h-full pl-3 overflow-auto scrollbar-always-visible">
                        <div className="flex flex-col gap-2">
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
                                        <Plus className="w-5 h-5 text-icon-primary" />
                                    </div>

                                    {/* Create Trigger Text */}
                                    <div className="flex-1 w-full">
                                        <div className="text-sm font-semibold text-text-heading truncate group-hover:text-text-action transition-colors">
                                            {t('triggers.create-hint')}
                                        </div>
                                    </div>
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

                {/* Right Side: Live Activity or Execution Logs (30% width) */}
                <div className="flex-[0.4] flex flex-col bg-surface-primary rounded-xl overflow-hidden mb-2 relative min-w-[240px]">
                    {/* Live Activity - Always rendered but slides out to the right when logs are shown */}
                    <div
                        className={`absolute inset-0 flex flex-col bg-surface-primary rounded-xl transition-transform duration-300 ease-in-out ${selectedTriggerId ? 'translate-x-full' : 'translate-x-0'
                            }`}
                    >
                        {/* Live Activity Header */}
                        <div className="flex items-center justify-between h-[48px] py-3 px-4">
                            <span className="text-label-sm font-bold text-text-heading">
                                {t('triggers.live-activity')}
                            </span>
                        </div>
                        {/* Live Activity Content */}
                        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-always-visible">
                            {activityLogs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                                    <Bell className="w-10 h-10 text-text-label mb-2" />
                                    <p className="text-text-label text-xs">{t('triggers.no-activity')}</p>
                                    <p className="text-text-label text-xs mt-1">{t('triggers.activity-hint')}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col pt-2">
                                    <AnimatePresence initial={false}>
                                        {activityLogs.slice(0, 50).map((log, index) => (
                                            <ActivityLogItem
                                                key={log.id}
                                                log={log}
                                                index={index}
                                                isExpanded={expandedLogs.has(log.id)}
                                                onToggleExpanded={() => toggleLogExpanded(log.id)}
                                            />
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Execution Logs - Slides in from the left */}
                    <div
                        className={`absolute inset-0 flex flex-col bg-surface-primary rounded-xl transition-transform duration-300 ease-in-out ${selectedTriggerId ? 'translate-x-0' : '-translate-x-full'
                            }`}
                    >
                        {/* Back button to return to Live Activity */}
                        <div className="flex flex-row items-center justify-start gap-2 px-3 py-3 bg-surface-tertiary relative">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSelectedTriggerId(null)}
                            >
                                <ArrowLeft />
                            </Button>
                            <span className="text-text-body font-bold text-label-sm">
                                {t('triggers.execution-logs')}
                            </span>
                        </div>
                        <div className="flex-1 min-h-0">
                            {selectedTriggerId && <ExecutionLogs triggerId={selectedTriggerId} />}
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Trigger Dialog */}
            <TriggerDialog
                key={editingTrigger?.id || 'new'}
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
                        title={t("triggers.delete-trigger")}
                    />
                    <DialogContentSection className="space-y-4">
                        <p className="text-text-body text-sm">
                            {t("triggers.confirm-delete-message", { name: deletingTrigger?.name })}
                        </p>
                    </DialogContentSection>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={() => setIsDeleteDialogOpen(false)}
                            disabled={isDeleting}
                        >
                            {t("triggers.cancel")}
                        </Button>
                        <Button
                            size="md"
                            onClick={handleConfirmDelete}
                            variant="cuation"
                            disabled={isDeleting}
                        >
                            {isDeleting ? t("triggers.deleting") : t("triggers.delete-trigger")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

