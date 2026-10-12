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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { cn } from '@/lib/utils';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import {
  CirclePlay,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  formatRunTime,
  formatScheduleLabel,
  getNextRun,
  parseTriggerSchedule,
} from './automationSchedule';

const WARN_AFTER_FAILURES = 2;

type TriggerListItemProps = {
  trigger: Trigger;
  isSelected: boolean;
  isNew?: boolean;
  isBusy?: boolean;
  onRunNow: (trigger: Trigger) => void | Promise<void>;
  onSelect: (id: number) => void;
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};

export const TriggerListItem: React.FC<TriggerListItemProps> = ({
  trigger,
  isSelected,
  isNew = false,
  isBusy = false,
  onRunNow,
  onSelect,
  onEdit,
  onDelete,
  onToggleActive,
}) => {
  const { t, i18n } = useTranslation();
  const isActive = trigger.status === TriggerStatus.Active;
  const needsAuth =
    trigger.status === TriggerStatus.PendingAuth &&
    trigger.config?.authentication_required;
  const failures = trigger.consecutive_failures ?? 0;

  const statusLine = (() => {
    if (needsAuth) {
      return { text: t('triggers.verification-required'), warn: true };
    }
    if (isActive && failures >= WARN_AFTER_FAILURES) {
      return {
        text: t('triggers.runs-did-not-complete', { count: failures }),
        warn: true,
      };
    }
    if (!isActive && trigger.auto_disabled_at) {
      return { text: t('triggers.auto-disabled-short'), warn: true };
    }
    if (trigger.trigger_type !== TriggerType.Schedule) {
      return { text: t('triggers.app-trigger'), warn: false };
    }
    const schedule = parseTriggerSchedule(trigger);
    const scheduleLabel = schedule
      ? formatScheduleLabel(schedule, t, i18n.language)
      : t('triggers.schedule-trigger');
    if (!isActive) {
      return {
        text: t('triggers.paused-schedule', { schedule: scheduleLabel }),
        warn: false,
      };
    }
    const nextRun = getNextRun(trigger);
    return {
      text: nextRun
        ? t('triggers.next-run-at', {
            time: formatRunTime(nextRun, i18n.language),
          })
        : scheduleLabel,
      warn: false,
    };
  })();

  return (
    <div
      className={cn(
        'group flex items-center gap-ds-8 rounded-ds-card border border-x border-y border-solid p-ds-12 transition-[border-color] duration-150 motion-reduce:transition-none',
        isSelected
          ? 'border-ds-hairline-strong-default bg-ds-neutral-default-default'
          : 'border-transparent hover:border-ds-hairline-default-hover',
        isNew && !isSelected && 'bg-ds-bg-information-subtle-default'
      )}
    >
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => onSelect(trigger.id)}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-ds-4 rounded-ds-field text-left',
          DS_FOCUS_RING
        )}
      >
        <div className="flex min-w-0 items-center gap-ds-6">
          <DsText
            as="span"
            role="base"
            weight="semibold"
            className="block truncate"
            title={trigger.name}
          >
            {trigger.name}
          </DsText>
          {isNew && (
            <DsText
              as="span"
              role="meta"
              weight="semibold"
              className="shrink-0 text-ds-text-information-strong-default"
            >
              {t('triggers.new-badge')}
            </DsText>
          )}
        </div>
        <DsText
          as="span"
          role="meta"
          weight={statusLine.warn ? 'semibold' : undefined}
          className={cn(
            'truncate',
            statusLine.warn
              ? 'text-ds-text-warning-strong-default'
              : 'text-ds-ink-muted-default'
          )}
          title={statusLine.text}
        >
          {statusLine.text}
        </DsText>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label={t('triggers.more-actions-named', {
              name: trigger.name,
            })}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuItem
            disabled={isBusy || !!needsAuth}
            onSelect={() => void onRunNow(trigger)}
          >
            <Play aria-hidden />
            {t('triggers.action-run-now')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isBusy || !!needsAuth}
            onSelect={() => onToggleActive(trigger)}
          >
            {isActive ? <Pause aria-hidden /> : <CirclePlay aria-hidden />}
            {t(isActive ? 'triggers.action-pause' : 'triggers.action-resume')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-ds-8"
            disabled={isBusy}
            onSelect={() => onEdit(trigger)}
          >
            <Pencil aria-hidden />
            {t('triggers.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-ds-8 text-ds-text-error-default-default focus:text-ds-text-error-strong-default"
            disabled={isBusy}
            onSelect={() => onDelete(trigger)}
          >
            <Trash2 aria-hidden />
            {t('triggers.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
