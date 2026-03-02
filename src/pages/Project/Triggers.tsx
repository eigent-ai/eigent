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
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  useTriggerCacheInvalidation,
  useUserTriggerCountQuery,
} from '@/hooks/queries/useTriggerQueries';
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
import { motion } from 'framer-motion';
import {
  ArrowUpDown,
  Plus,
  SquareChevronRight,
  SquareCode,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const EXECUTION_LOGS_OPEN_STORAGE_KEY = 'triggers.executionLogs.open';

export default function Overview() {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<
    'createdAt' | 'lastExecutionTime' | 'tokens'
  >('createdAt');
  const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(
    null
  );
  const [isExecutionLogsOpen, setIsExecutionLogsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.localStorage.getItem(EXECUTION_LOGS_OPEN_STORAGE_KEY) === 'true'
    );
  });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingTrigger, setDeletingTrigger] = useState<Trigger | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { setHasTriggers } = usePageTabStore();

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

  const { addLog } = useActivityLogStore();

  // User trigger count query (cached, across all projects)
  const { data: userTriggerCount = 0 } = useUserTriggerCountQuery();
  const { invalidateUserTriggerCount } = useTriggerCacheInvalidation();

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

  // Reset selected trigger when project changes
  useEffect(() => {
    setSelectedTriggerId(null);
  }, [projectStore.activeProjectId]);

  useEffect(() => {
    window.localStorage.setItem(
      EXECUTION_LOGS_OPEN_STORAGE_KEY,
      String(isExecutionLogsOpen)
    );
  }, [isExecutionLogsOpen]);

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
    } catch (error: any) {
      console.error('Failed to update trigger status:', error);

      // Check if the error is due to activation limits
      const errorMessage =
        error?.response?.data?.detail || error?.message || '';
      if (
        isActivating &&
        typeof errorMessage === 'string' &&
        (errorMessage.includes('Maximum number of active triggers') ||
          errorMessage.includes(
            'Maximum number of concurrent active triggers'
          ) ||
          errorMessage.includes('active trigger limit'))
      ) {
        toast.error(t('triggers.activation-limit-reached'));
      } else {
        toast.error(t('triggers.failed-to-toggle'));
      }
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
    setIsExecutionLogsOpen(true);
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
        setIsExecutionLogsOpen(false);
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

      // Invalidate user trigger count cache after deletion
      invalidateUserTriggerCount();
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
    <div className="min-h-0 min-w-0 flex h-full flex-1 flex-col">
      <div className="bg-surface-secondary px-2 pt-2 flex h-full flex-row">
        {/* Left Side: Trigger List */}
        <div className="min-w-0 flex flex-1 flex-col">
          {/* Header */}
          <div className="pb-4 pl-1 pt-2 flex w-full items-center justify-between">
            <div className="text-body-sm font-bold text-text-heading">
              {t('triggers.title')}
            </div>
            <div className="gap-1 pr-2 flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-semibold opacity-50"
                  >
                    {getSortLabel()}
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
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
              <TooltipSimple
                content={
                  isExecutionLogsOpen
                    ? 'Fold execution logs'
                    : 'Open execution logs'
                }
                delayDuration={300}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-70"
                  disabled={sortedTriggers.length === 0}
                  onClick={() => {
                    if (isExecutionLogsOpen) {
                      setIsExecutionLogsOpen(false);
                      return;
                    }

                    if (!selectedTriggerId && sortedTriggers.length > 0) {
                      setSelectedTriggerId(sortedTriggers[0].id);
                    }
                    setIsExecutionLogsOpen(true);
                  }}
                >
                  {isExecutionLogsOpen ? (
                    <SquareChevronRight className="h-4 w-4" />
                  ) : (
                    <SquareCode className="h-4 w-4" />
                  )}
                </Button>
              </TooltipSimple>
            </div>
          </div>

          {/* List View Section */}
          <div className="scrollbar-always-visible flex h-full flex-col overflow-auto">
            <div className="gap-2 flex flex-col">
              {sortedTriggers.length === 0 ? (
                <div
                  onClick={() => {
                    setEditingTrigger(null);
                    setEditDialogOpen(true);
                  }}
                  className="group gap-3 rounded-xl border-border-tertiary bg-surface-primary p-3 hover:border-border-secondary hover:bg-surface-tertiary flex cursor-pointer items-center justify-center border transition-all duration-200"
                >
                  {/* Zap Icon */}
                  <div className="bg-amber-500/10 h-10 w-10 rounded-lg flex flex-shrink-0 items-center justify-center">
                    <Plus className="h-5 w-5 text-icon-primary" />
                  </div>

                  {/* Create Trigger Text */}
                  <div className="w-full flex-1">
                    <div className="text-sm font-semibold text-text-heading group-hover:text-text-action truncate transition-colors">
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

        {/* Execution Logs - Slides in/out from the right */}
        <motion.div
          initial={false}
          animate={
            selectedTriggerId && isExecutionLogsOpen
              ? {
                  width: '40%',
                  minWidth: 240,
                  maxWidth: 560,
                  marginLeft: 8,
                  opacity: 1,
                  x: 0,
                }
              : {
                  width: 0,
                  minWidth: 0,
                  maxWidth: 0,
                  marginLeft: 0,
                  opacity: 0,
                  x: 20,
                }
          }
          transition={{
            type: 'spring',
            stiffness: 340,
            damping: 34,
            mass: 0.9,
          }}
          className={`mb-2 rounded-xl bg-surface-primary flex h-full flex-col overflow-hidden ${
            selectedTriggerId && isExecutionLogsOpen
              ? ''
              : 'pointer-events-none'
          }`}
        >
          <div className="min-h-0 flex h-full flex-col">
            <div className="bg-surface-tertiary px-3 py-3 relative flex flex-row items-center justify-start">
              <span className="text-label-sm font-bold text-text-body">
                {t('triggers.execution-logs')}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {selectedTriggerId && isExecutionLogsOpen && (
                <ExecutionLogs triggerId={selectedTriggerId} />
              )}
            </div>
          </div>
        </motion.div>
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
