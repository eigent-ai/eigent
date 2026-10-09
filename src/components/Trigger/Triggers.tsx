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

import ContentHeader from '@/components/Layout/ContentHeader';
import { RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { AutomationDashboard } from '@/components/Trigger/AutomationDashboard';
import { AutomationExamples } from '@/components/Trigger/AutomationExamples';
import { AutomationMainPanel } from '@/components/Trigger/AutomationMainPanel';
import {
  TriggerDialog,
  type TriggerDraft,
} from '@/components/Trigger/TriggerDialog';
import { TriggerListItem } from '@/components/Trigger/TriggerListItem';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import { useTriggerCacheInvalidation } from '@/hooks/queries/useTriggerQueries';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import {
  proxyActivateTrigger,
  proxyDeactivateTrigger,
  proxyDeleteTrigger,
  proxyFetchProjectTriggers,
  proxyRunTriggerNow,
} from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useTriggerStore } from '@/store/triggerStore';
import { Trigger, TriggerStatus } from '@/types';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AutomationExample } from './automationExampleData';
import { scheduleToCron } from './automationSchedule';

const NEW_ROW_HIGHLIGHT_MS = 6000;

const byNewestFirst = (a: Trigger, b: Trigger) =>
  new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

export type OverviewProps = {
  selectedTriggerId: number | null;
  onSelectedTriggerIdChange: (id: number | null) => void;
  isDialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
};

export default function Overview({
  selectedTriggerId,
  onSelectedTriggerIdChange,
  isDialogOpen,
  onDialogOpenChange,
}: OverviewProps) {
  const { t } = useTranslation();
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingTrigger, setDeletingTrigger] = useState<Trigger | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const busyIds = useRef(new Set<number>());
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const beginAction = (id: number) => {
    if (busyIds.current.has(id)) return false;
    busyIds.current.add(id);
    setPendingIds([...busyIds.current]);
    return true;
  };
  const finishAction = (id: number) => {
    busyIds.current.delete(id);
    setPendingIds([...busyIds.current]);
  };
  const { setHasTriggers } = usePageTabStore();
  const { triggers, deleteTrigger, updateTrigger, setTriggers } =
    useTriggerStore();
  const { projectStore } = useChatStoreAdapter();
  const { addLog } = useActivityLogStore();
  const { invalidateUserTriggerCount } = useTriggerCacheInvalidation();

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

  useEffect(() => {
    setHasTriggers(triggers.length > 0);
  }, [triggers, setHasTriggers]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const sortedTriggers = useMemo(
    () => [...triggers].sort(byNewestFirst),
    [triggers]
  );
  const selectedTrigger =
    triggers.find((trigger) => trigger.id === selectedTriggerId) ?? null;

  const openDialog = (next: { trigger?: Trigger; draft?: TriggerDraft }) => {
    setEditingTrigger(next.trigger ?? null);
    setDraft(next.draft ?? null);
    onDialogOpenChange(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    onDialogOpenChange(open);
    if (!open) {
      setEditingTrigger(null);
      setDraft(null);
    }
  };

  const handleSelectExample = (example: AutomationExample) => {
    openDialog({
      draft: {
        name: t(`triggers.examples.${example.id}.title`),
        taskPrompt: t(`triggers.examples.${example.id}.prompt`),
        cronExpression: scheduleToCron(example.schedule),
      },
    });
  };

  const handleTriggerCreated = (trigger: Trigger) => {
    setJustAddedId(trigger.id);
    later(
      () => setJustAddedId((id) => (id === trigger.id ? null : id)),
      NEW_ROW_HIGHLIGHT_MS
    );
  };

  const handleRunNow = async (trigger: Trigger) => {
    if (!beginAction(trigger.id)) return;
    try {
      await proxyRunTriggerNow(trigger.id);
      toast.success(t('triggers.action-run-queued'));
    } catch (error) {
      console.error('Failed to request automation run:', error);
      toast.error(t('triggers.action-run-failed'));
    } finally {
      finishAction(trigger.id);
    }
  };

  const handleToggleActive = async (trigger: Trigger) => {
    if (!beginAction(trigger.id)) return;
    const isActivating = trigger.status !== TriggerStatus.Active;
    try {
      if (isActivating) {
        await proxyActivateTrigger(trigger.id);
      } else {
        await proxyDeactivateTrigger(trigger.id);
      }
      updateTrigger(trigger.id, {
        status: isActivating ? TriggerStatus.Active : TriggerStatus.Inactive,
      });
      toast.success(
        isActivating ? t('triggers.activated') : t('triggers.deactivated')
      );
      addLog({
        type: isActivating
          ? ActivityType.TriggerActivated
          : ActivityType.TriggerDeactivated,
        message: isActivating
          ? t('triggers.activity-activated', {
              name: trigger.name,
              defaultValue: 'Automation "{{name}}" activated',
            })
          : t('triggers.activity-deactivated', {
              name: trigger.name,
              defaultValue: 'Automation "{{name}}" deactivated',
            }),
        projectId: projectStore.activeProjectId || undefined,
        triggerId: trigger.id,
        triggerName: trigger.name,
      });
    } catch (error: any) {
      console.error('Failed to update trigger status:', error);
      const errorMessage =
        error?.response?.data?.detail || error?.message || '';
      const hitLimit =
        isActivating &&
        typeof errorMessage === 'string' &&
        (errorMessage.includes('Maximum number of active triggers') ||
          errorMessage.includes(
            'Maximum number of concurrent active triggers'
          ) ||
          errorMessage.includes('active trigger limit'));
      toast.error(
        hitLimit
          ? t('triggers.activation-limit-reached')
          : t('triggers.failed-to-toggle')
      );
    } finally {
      finishAction(trigger.id);
    }
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
        onSelectedTriggerIdChange(null);
      }
      addLog({
        type: ActivityType.TriggerDeleted,
        message: t('triggers.activity-deleted', {
          name: deletingTrigger.name,
          defaultValue: 'Automation "{{name}}" deleted',
        }),
        projectId: projectStore.activeProjectId || undefined,
        triggerId: deletingTrigger.id,
        triggerName: deletingTrigger.name,
      });
      toast.success(t('triggers.deleted'));
      setIsDeleteDialogOpen(false);
      setDeletingTrigger(null);
      invalidateUserTriggerCount();
    } catch (error) {
      console.error('Failed to delete trigger:', error);
      toast.error(t('triggers.failed-to-delete'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col lg:flex-row">
      <AutomationMainPanel
        trigger={selectedTrigger}
        onBack={() => onSelectedTriggerIdChange(null)}
        onEdit={(trigger) => openDialog({ trigger })}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
        isBusy={
          selectedTrigger ? pendingIds.includes(selectedTrigger.id) : false
        }
      >
        {selectedTrigger ? (
          <div className="mx-auto w-full max-w-5xl">
            <AutomationDashboard
              key={selectedTrigger.id}
              trigger={selectedTrigger}
            />
          </div>
        ) : (
          <AutomationExamples onSelectExample={handleSelectExample} />
        )}
      </AutomationMainPanel>

      <aside
        aria-labelledby="your-automations-title"
        className={cn(
          'flex max-h-[40%] min-h-0 shrink-0 flex-col border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default lg:max-h-none lg:border-t-0 lg:border-r-0 lg:border-b-0 lg:border-l',
          RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS
        )}
      >
        <ContentHeader
          border={false}
          inset="none"
          className="px-ds-16"
          actions={
            <Button variant="primary" size="sm" onClick={() => openDialog({})}>
              <Plus aria-hidden />
              {t('triggers.create')}
            </Button>
          }
        >
          <DsText
            as="h2"
            id="your-automations-title"
            role="base"
            weight="semibold"
          >
            {t('triggers.your-automations')}
            <span className="ml-ds-6 font-medium text-ds-ink-subtle-default">
              {sortedTriggers.length}
            </span>
          </DsText>
        </ContentHeader>

        <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto pr-0 pb-ds-16 pl-ds-8">
          {sortedTriggers.length === 0 ? (
            <div className="m-ds-8 flex flex-col gap-ds-4 rounded-ds-card border border-x border-y border-dashed border-ds-hairline-default-default px-ds-16 py-ds-24 text-center">
              <DsText as="p" role="base" weight="semibold">
                {t('triggers.no-triggers')}
              </DsText>
              <DsText as="p" role="base" className="text-ds-ink-muted-default">
                {t('triggers.queue-empty-body')}
              </DsText>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-ds-2 p-0">
              {sortedTriggers.map((trigger) => (
                <li key={trigger.id}>
                  <TriggerListItem
                    trigger={trigger}
                    isSelected={selectedTriggerId === trigger.id}
                    isNew={justAddedId === trigger.id}
                    isBusy={pendingIds.includes(trigger.id)}
                    onRunNow={handleRunNow}
                    onSelect={onSelectedTriggerIdChange}
                    onEdit={(item) => openDialog({ trigger: item })}
                    onDelete={handleDelete}
                    onToggleActive={handleToggleActive}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <TriggerDialog
        key={editingTrigger?.id ?? draft?.name ?? 'new'}
        selectedTrigger={editingTrigger}
        draft={draft}
        isOpen={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        onTriggerCreated={(trigger) => {
          if (!editingTrigger) handleTriggerCreated(trigger);
        }}
      />

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
            <p className="text-sm text-ds-ink-default-default">
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
              variant="primary"
              tone="error"
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
