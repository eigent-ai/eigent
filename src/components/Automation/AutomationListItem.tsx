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
import { Switch } from '@/components/ui/switch';
import { TooltipSimple } from '@/components/ui/tooltip';
import { iconForTriggerType } from '@/lib/triggerIcon';
import { formatDateTime } from '@/lib/utils';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import {
  AlarmClockIcon,
  AlertTriangle,
  Clock,
  Edit,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  WebhookIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type AutomationListItemProps = {
  automation: Trigger;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onEdit: (automation: Trigger) => void;
  onDuplicate: (id: number) => void;
  onDelete: (automation: Trigger) => void;
  onToggleActive: (automation: Trigger) => void;
};

export const AutomationListItem: React.FC<AutomationListItemProps> = ({
  automation,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate: _onDuplicate,
  onDelete,
  onToggleActive,
}) => {
  const { t } = useTranslation();
  const isActive = automation.status === TriggerStatus.Active;
  const needsAuth =
    automation.status === TriggerStatus.PendingAuth &&
    automation.config?.authentication_required;

  const getTriggerTypeIcon = () => {
    switch (automation.trigger_type) {
      case TriggerType.Schedule:
        return <AlarmClockIcon className="h-3.5 w-3.5" />;
      case TriggerType.Webhook:
        return <WebhookIcon className="h-3.5 w-3.5" />;
      case TriggerType.Slack:
        return <MessageSquare className="h-3.5 w-3.5" />;
      default:
        return <Clock className="h-3.5 w-3.5" />;
    }
  };

  const getTriggerTypeLabel = () => {
    switch (automation.trigger_type) {
      case TriggerType.Schedule:
        return t('triggers.schedule-trigger');
      case TriggerType.Webhook:
        return t('triggers.webhook-trigger');
      case TriggerType.Slack:
        return t('triggers.slack-trigger');
      default:
        return automation.trigger_type;
    }
  };

  const _formatLastRun = (dateString?: string) => {
    if (!dateString) return t('triggers.never');
    return formatDateTime(dateString, 'HH:mm MMM dd');
  };

  const TriggerIcon = iconForTriggerType(automation.trigger_type);

  return (
    <div
      onClick={() => onSelect(automation.id)}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border border-solid border-transparent !bg-ds-bg-neutral-default-default p-3 transition-[background-color,border-color] duration-200 ${
        isSelected
          ? '!border-ds-border-neutral-strong-default !bg-ds-bg-neutral-strong-default'
          : needsAuth
            ? 'hover:!bg-ds-bg-neutral-strong-default'
            : 'hover:!bg-ds-bg-neutral-strong-default'
      }`}
    >
      {/* 1. Icon for the event that starts this automation */}
      <div className="bg-amber-500/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
        <TriggerIcon className="h-5 w-5 text-ds-icon-neutral-default-default" />
      </div>

      {/* 2. Automation name + task prompt */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold text-ds-text-neutral-default-default transition-colors group-hover:text-ds-text-brand-default-hover">
            {automation.name}
          </div>
          {needsAuth && (
            <TooltipSimple content={t('triggers.verification-required')}>
              <div className="flex items-center justify-center rounded-full bg-yellow-100 p-1">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />
              </div>
            </TooltipSimple>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-ds-text-neutral-muted-default">
          {automation.task_prompt ||
            automation.description ||
            t('triggers.no-task-prompt')}
        </div>
      </div>

      {/* 3. Automation type */}
      <div className="flex min-w-[80px] items-center gap-1.5 text-xs text-ds-text-neutral-muted-default">
        {getTriggerTypeIcon()}
        <span>{getTriggerTypeLabel()}</span>
      </div>

      {/* 5. Activation Switch */}
      <TooltipSimple
        content={t('triggers.verification-required')}
        enabled={needsAuth}
      >
        <div>
          <Switch
            checked={isActive || needsAuth}
            onCheckedChange={() => onToggleActive(automation)}
            onClick={(e) => e.stopPropagation()}
            disabled={needsAuth}
          />
        </div>
      </TooltipSimple>

      {/* 6. More Icon Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              onEdit(automation);
            }}
          >
            <Edit className="h-4 w-4" />
            {t('triggers.edit')}
          </DropdownMenuItem>
          {/* TODO: Support Duplicate Action */}
          {/* <DropdownMenuItem className="gap-2" onSelect={(e) => { e.preventDefault(); onDuplicate(automation.id); }}>
                        <Copy className="h-4 w-4" />
                        {t("triggers.duplicate")}
                    </DropdownMenuItem> */}
          <DropdownMenuItem
            className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default"
            onSelect={(e) => {
              e.preventDefault();
              onDelete(automation);
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t('triggers.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
