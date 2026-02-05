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

import { ActivityLogItem } from '@/components/Trigger/ActivityLogItem';
import { ExecutionLogs } from '@/components/Trigger/ExecutionLogs';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { TriggerListItem } from '@/components/Trigger/TriggerListItem';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import {
  proxyActivateTrigger,
  proxyDeactivateTrigger,
  proxyDeleteTrigger,
  proxyFetchProjectTriggers,
} from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Trigger, TriggerStatus } from '@/types';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowUpDown, Bell, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export default function Overview() {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<
    'createdAt' | 'lastExecutionTime' | 'tokens'
  >('createdAt');
  const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(
    null
  );
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingTrigger, setDeletingTrigger] = useState<Trigger | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const { setHasTriggers } = usePageTabStore();

  const toggleLogExpanded = (logId: string) => {
    setExpandedLogs((prev) => {
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
  const {
    triggers,
    deleteTrigger,
    duplicateTrigger,
    updateTrigger,
    addTrigger,
    setTriggers,
  } = useTriggerStore();

  // Get projectStore for the active project's task
  const { projectStore } = useChatStoreAdapter();

  // Use activity log store - subscribe to logs for reactivity
  const { logs: allLogs, addLog } = useActivityLogStore();

  // Get project-specific activity logs using useMemo for performance
  const activityLogs = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return allLogs
      .filter((log) => log.projectId === projectStore.activeProjectId)
      .slice(0, 50);
  }, [allLogs, projectStore.activeProjectId]);

  // Fetch triggers from API on mount
  useEffect(() => {
    const fetchTriggers = async () => {
      try {
        const response = await proxyFetchProjectTriggers(
          projectStore.activeProjectId
        );
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
      case 'createdAt':
        return (
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
        );
      case 'lastExecutionTime':
        return (
          new Date(b.last_executed_at || 0).getTime() -
          new Date(a.last_executed_at || 0).getTime()
        );
      default:
        return 0;
    }
  });

  const getSortLabel = () => {
    switch (sortBy) {
      case 'createdAt':
        return t('triggers.created-time');
      case 'lastExecutionTime':
        return t('triggers.last-execution-label');
      case 'tokens':
        return t('triggers.token-cost');
    }
  };

  const handleToggleActive = async (trigger: Trigger) => {
    const newStatus =
      trigger.status === TriggerStatus.Active
        ? TriggerStatus.Inactive
        : TriggerStatus.Active;
    const isActivating = newStatus === TriggerStatus.Active;

    try {
      const response = isActivating
        ? await proxyActivateTrigger(trigger.id)
        : await proxyDeactivateTrigger(trigger.id);
      console.log(
        `Trigger ${isActivating ? 'activation' : 'deactivation'} response:`,
        response
      );

      updateTrigger(trigger.id, { status: newStatus });
      toast.success(
        isActivating ? t('triggers.activated') : t('triggers.deactivated')
      );

      // Add activity log
      addLog({
        type: isActivating
          ? ActivityType.TriggerActivated
          : ActivityType.TriggerDeactivated,
        message: `Trigger "${trigger.name}" ${isActivating ? 'activated' : 'deactivated'}`,
        projectId: projectStore.activeProjectId || undefined,
        triggerId: trigger.id,
        triggerName: trigger.name,
      });
    } catch (error) {
      console.error('Failed to update trigger status:', error);
      toast.error(t('triggers.failed-to-toggle'));
      return;
    }
  };

  const setSelectedTriggerIdWrapper = (triggerId: number) => {
    //Double Click to Edit
    if (triggerId === selectedTriggerId) {
      handleEdit(triggers.find((t) => t.id === triggerId)!);
      return;
    }
    setSelectedTriggerId(triggerId);
  };

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

      toast.success(t('triggers.deleted'));
      setIsDeleteDialogOpen(false);
      setDeletingTrigger(null);
    } catch (error) {
      console.error('Failed to delete trigger:', error);
      toast.error(t('triggers.failed-to-delete'));
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

      toast.success(
        t('triggers.duplicated-successfully', { name: duplicated.name })
      );
    }
  };

  const handleDialogClose = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      setEditingTrigger(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-full flex-row gap-2 bg-surface-secondary px-2 pt-2">
        {/* Left Side: Trigger List (70% width) */}
        <div className="flex min-w-0 flex-[0.6] flex-col">
          {/* Header */}
          <div className="flex w-full items-center justify-between pb-4 pl-1 pt-2">
            <div className="text-body-sm font-bold text-text-heading">
              {t('triggers.title')}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-label-sm font-semibold text-text-label opacity-50"
                  >
                    {getSortLabel()}
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy('createdAt')}>
                  {t('triggers.created-time')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortBy('lastExecutionTime')}
                >
                  {t('triggers.last-execution-label')}
                </DropdownMenuItem>
                {/* TODO: Support Token Cost */}
                {/* <DropdownMenuItem onClick={() => setSortBy("tokens")}>
                                    {t('triggers.token-cost')}
                                </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* List View Section */}
          <div className="scrollbar-always-visible flex h-full flex-col overflow-auto">
            <div className="flex flex-col gap-2">
              {sortedTriggers.length === 0 ? (
                <div
                  onClick={() => {
                    setEditingTrigger(null);
                    setEditDialogOpen(true);
                  }}
                  className="group flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-border-tertiary bg-surface-primary p-3 transition-all duration-200 hover:border-border-secondary hover:bg-surface-tertiary"
                >
                  {/* Zap Icon */}
                  <div className="bg-amber-500/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                    <Plus className="h-5 w-5 text-icon-primary" />
                  </div>

                  {/* Create Trigger Text */}
                  <div className="w-full flex-1">
                    <div className="truncate text-sm font-semibold text-text-heading transition-colors group-hover:text-text-action">
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
        <div className="relative mb-2 flex min-w-[240px] flex-[0.4] flex-col overflow-hidden rounded-xl bg-surface-primary">
          {/* Live Activity - Always rendered but slides out to the right when logs are shown */}
          <div
            className={`absolute inset-0 flex flex-col rounded-xl bg-surface-primary transition-transform duration-300 ease-in-out ${
              selectedTriggerId ? 'translate-x-full' : 'translate-x-0'
            }`}
          >
            {/* Live Activity Header */}
            <div className="flex h-[48px] items-center justify-between px-4 py-3">
              <span className="text-label-sm font-bold text-text-heading">
                {t('triggers.live-activity')}
              </span>
            </div>
            {/* Live Activity Content */}
            <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
              {activityLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <Bell className="mb-2 h-10 w-10 text-text-label" />
                  <p className="text-xs text-text-label">
                    {t('triggers.no-activity')}
                  </p>
                  <p className="mt-1 text-xs text-text-label">
                    {t('triggers.activity-hint')}
                  </p>
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
            className={`absolute inset-0 flex flex-col rounded-xl bg-surface-primary transition-transform duration-300 ease-in-out ${
              selectedTriggerId ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {/* Back button to return to Live Activity */}
            <div className="relative flex flex-row items-center justify-start gap-2 bg-surface-tertiary px-3 py-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedTriggerId(null)}
              >
                <ArrowLeft />
              </Button>
              <span className="text-label-sm font-bold text-text-body">
                {t('triggers.execution-logs')}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {selectedTriggerId && (
                <ExecutionLogs triggerId={selectedTriggerId} />
              )}
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
          <DialogHeader title={t('triggers.delete-trigger')} />
          <DialogContentSection className="space-y-4">
            <p className="text-sm text-text-body">
              {t('triggers.confirm-delete-message', {
                name: deletingTrigger?.name,
              })}
            </p>
          </DialogContentSection>
          <DialogFooter>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {t('triggers.cancel')}
            </Button>
            <Button
              size="md"
              onClick={handleConfirmDelete}
              variant="cuation"
              disabled={isDeleting}
            >
              {isDeleting
                ? t('triggers.deleting')
                : t('triggers.delete-trigger')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
