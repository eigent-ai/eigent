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
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Switch } from '@/components/ui/switch';
import { TooltipSimple } from '@/components/ui/tooltip';
import { iconForTriggerType } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  formatRunTime,
  formatScheduleLabel,
  getNextRun,
  parseCron,
} from './automationSchedule';

const WARN_AFTER_FAILURES = 2;

type TriggerListItemProps = {
  trigger: Trigger;
  isSelected: boolean;
  isNew?: boolean;
  onSelect: (id: number) => void;
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};

export const TriggerListItem: React.FC<TriggerListItemProps> = ({
  trigger,
  isSelected,
  isNew = false,
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
  const TriggerIcon = iconForTriggerType(trigger.trigger_type);
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
    const schedule = parseCron(trigger.custom_cron_expression);
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
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(trigger.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(trigger.id);
        }
      }}
      className={cn(
        'group flex min-h-ds-control-xl cursor-pointer items-center gap-ds-10 rounded-ds-field border border-x border-y border-solid px-ds-8 py-ds-10 transition-[background-color,border-color] duration-150 motion-reduce:transition-none',
        isSelected
          ? 'border-ds-hairline-strong-default bg-ds-neutral-strong-default'
          : 'border-transparent hover:bg-ds-neutral-default-default',
        isNew && !isSelected && 'bg-ds-bg-information-subtle-default',
        DS_FOCUS_RING
      )}
    >
      <span className="flex size-ds-control-md shrink-0 items-center justify-center rounded-ds-compact-control bg-ds-neutral-default-default text-ds-ink-muted-default">
        <DsIcon icon={TriggerIcon} recipe="main" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-ds-6">
          <DsText as="span" role="base" weight="semibold" className="truncate">
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
      </div>

      <TooltipSimple
        content={t('triggers.verification-required')}
        enabled={!!needsAuth}
      >
        <div onClick={(event) => event.stopPropagation()}>
          <Switch
            size="sm"
            checked={isActive || !!needsAuth}
            onCheckedChange={() => onToggleActive(trigger)}
            disabled={!!needsAuth}
            aria-label={t(
              isActive ? 'triggers.turn-off-named' : 'triggers.turn-on-named',
              { name: trigger.name }
            )}
          />
        </div>
      </TooltipSimple>

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
            className="gap-ds-8"
            onSelect={(event) => {
              event.preventDefault();
              onEdit(trigger);
            }}
          >
            <Pencil aria-hidden />
            {t('triggers.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-ds-8 text-ds-text-error-default-default focus:text-ds-text-error-strong-default"
            onSelect={(event) => {
              event.preventDefault();
              onDelete(trigger);
            }}
          >
            <Trash2 aria-hidden />
            {t('triggers.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
