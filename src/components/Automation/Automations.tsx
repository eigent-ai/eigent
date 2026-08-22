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

import { AutomationDialog } from '@/components/Automation/AutomationDialog';
import { AutomationListItem } from '@/components/Automation/AutomationListItem';
import { AutomationRunHistory } from '@/components/Automation/AutomationRunHistory';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { useTriggerCacheInvalidation } from '@/hooks/queries/useTriggerQueries';
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
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export const AUTOMATION_RUN_HISTORY_OPEN_STORAGE_KEY =
  'triggers.executionLogs.open';

export type AutomationSortKey = 'createdAt' | 'lastExecutionTime' | 'tokens';

export function sortAutomationsList(
  automations: Trigger[],
  sortBy: AutomationSortKey
): Trigger[] {
  return [...automations].sort((a, b) => {
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
}

export type AutomationsOverviewProps = {
  sortBy: AutomationSortKey;
  selectedAutomationId: number | null;
  onSelectedAutomationIdChange: (id: number | null) => void;
  isAutomationRunHistoryOpen: boolean;
  onAutomationRunHistoryOpenChange: (open: boolean) => void;
};

export default function AutomationsOverview({
  sortBy,
  selectedAutomationId,
  onSelectedAutomationIdChange,
  isAutomationRunHistoryOpen,
  onAutomationRunHistoryOpenChange,
}: AutomationsOverviewProps) {
  const { t } = useTranslation();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Trigger | null>(
    null
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingAutomation, setDeletingAutomation] = useState<Trigger | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const { setHasTriggers } = usePageTabStore();

  // Use trigger store
  const {
    triggers,
    deleteTrigger,
    duplicateTrigger,
    updateTrigger,
    setTriggers,
  } = useTriggerStore();

  // Get projectStore for the active project's task
  const { projectStore } = useChatStoreAdapter();

  const { addLog } = useActivityLogStore();

  const { invalidateUserTriggerCount } = useTriggerCacheInvalidation();

  // Fetch backend Trigger records on mount.
  useEffect(() => {
    const fetchTriggers = async () => {
      try {
        const response = await proxyFetchProjectTriggers(
          projectStore.activeProjectId
        );

        setTriggers(response.items || []);
      } catch (error) {
        console.error('Failed to fetch triggers:', error);
        toast.error(t('triggers.failed-to-load'));
      }
    };

    fetchTriggers();
  }, [projectStore, projectStore.activeProjectId, setTriggers, t]);

  // Update hasTriggers based on the trigger list
  useEffect(() => {
    setHasTriggers(triggers.length > 0);
  }, [triggers, setHasTriggers]);

  const sortedAutomations = sortAutomationsList(triggers, sortBy);

  const handleToggleActive = async (automation: Trigger) => {
    const newStatus =
      automation.status === TriggerStatus.Active
        ? TriggerStatus.Inactive
        : TriggerStatus.Active;
    const isActivating = newStatus === TriggerStatus.Active;

    try {
      if (isActivating) {
        await proxyActivateTrigger(automation.id);
      } else {
        await proxyDeactivateTrigger(automation.id);
      }

      updateTrigger(automation.id, { status: newStatus });
      toast.success(
        isActivating ? t('triggers.activated') : t('triggers.deactivated')
      );

      // Add activity log
      addLog({
        type: isActivating
          ? ActivityType.TriggerActivated
          : ActivityType.TriggerDeactivated,
        message: `Automation "${automation.name}" ${isActivating ? 'activated' : 'deactivated'}`,
        projectId: projectStore.activeProjectId || undefined,
        triggerId: automation.id,
        triggerName: automation.name,
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

  const setSelectedAutomationIdWrapper = (automationId: number) => {
    //Double Click to Edit
    if (automationId === selectedAutomationId) {
      handleEdit(
        triggers.find((automation) => automation.id === automationId)!
      );
      return;
    }
    onSelectedAutomationIdChange(automationId);
    onAutomationRunHistoryOpenChange(true);
  };

  const handleEdit = (automation: Trigger) => {
    setEditingAutomation(automation);
    setEditDialogOpen(true);
  };

  const handleDelete = (automation: Trigger) => {
    setDeletingAutomation(automation);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAutomation) return;

    setIsDeleting(true);
    try {
      await proxyDeleteTrigger(deletingAutomation.id);
      deleteTrigger(deletingAutomation.id);

      if (selectedAutomationId === deletingAutomation.id) {
        onSelectedAutomationIdChange(null);
        onAutomationRunHistoryOpenChange(false);
      }

      // Add activity log
      addLog({
        type: ActivityType.TriggerDeleted,
        message: `Automation "${deletingAutomation.name}" deleted`,
        projectId: projectStore.activeProjectId || undefined,
        triggerId: deletingAutomation.id,
        triggerName: deletingAutomation.name,
      });

      toast.success(t('triggers.deleted'));
      setIsDeleteDialogOpen(false);
      setDeletingAutomation(null);

      // Invalidate user trigger count cache after deletion
      invalidateUserTriggerCount();
    } catch (error) {
      console.error('Failed to delete automation:', error);
      toast.error(t('triggers.failed-to-delete'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDuplicate = (automationId: number) => {
    const duplicated = duplicateTrigger(automationId);
    if (duplicated) {
      // Add activity log
      addLog({
        type: ActivityType.TriggerCreated,
        message: `Automation "${duplicated.name}" created (duplicated)`,
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
      setEditingAutomation(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-full flex-row pl-2">
        {/* Left side: automation list */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* List View Section */}
          <div className="scrollbar-always-visible mx-auto flex h-full w-full max-w-[800px] flex-col overflow-auto pt-2">
            <div className="flex flex-col gap-2">
              {sortedAutomations.length === 0 ? (
                <div
                  onClick={() => {
                    setEditingAutomation(null);
                    setEditDialogOpen(true);
                  }}
                  className="group flex cursor-pointer items-center justify-center gap-3 rounded-xl bg-ds-bg-neutral-default-default p-3 transition-opacity duration-200 hover:opacity-60"
                >
                  {/* Add icon */}
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-subtle-default">
                    <Plus className="h-5 w-5 text-ds-icon-neutral-default-default" />
                  </div>

                  {/* Create automation text */}
                  <div className="w-full flex-1">
                    <div className="truncate text-sm font-semibold text-ds-text-neutral-muted-default transition-colors group-hover:text-ds-text-brand-default-hover">
                      {t('triggers.create-hint')}
                    </div>
                  </div>
                </div>
              ) : (
                sortedAutomations.map((automation) => (
                  <AutomationListItem
                    key={automation.id}
                    automation={automation}
                    isSelected={selectedAutomationId === automation.id}
                    onSelect={setSelectedAutomationIdWrapper}
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

        {/* Automation run history - slides in/out from the right */}
        <motion.div
          initial={false}
          animate={
            selectedAutomationId && isAutomationRunHistoryOpen
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
          className={`mb-2 flex h-full flex-col overflow-hidden border border-y-0 border-r-0 border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default ${
            selectedAutomationId && isAutomationRunHistoryOpen
              ? ''
              : 'pointer-events-none'
          }`}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="relative flex flex-row items-center justify-start px-3 py-3">
              <span className="text-label-sm font-bold text-ds-text-neutral-default-default">
                {t('triggers.execution-logs')}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {selectedAutomationId && isAutomationRunHistoryOpen && (
                <AutomationRunHistory automationId={selectedAutomationId} />
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Edit Automation Dialog */}
      <AutomationDialog
        key={editingAutomation?.id || 'new'}
        selectedAutomation={editingAutomation}
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
            <p className="text-sm text-ds-text-neutral-default-default">
              {t('triggers.confirm-delete-message', {
                name: deletingAutomation?.name,
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
              variant="caution"
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
