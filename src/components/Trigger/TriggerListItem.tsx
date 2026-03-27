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
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TriggerListItemProps = {
  trigger: Trigger;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onEdit: (trigger: Trigger) => void;
  onDuplicate: (id: number) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};

export const TriggerListItem: React.FC<TriggerListItemProps> = ({
  trigger,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleActive,
}) => {
  const { t } = useTranslation();
  const isActive = trigger.status === TriggerStatus.Active;
  const needsAuth =
    trigger.status === TriggerStatus.PendingAuth &&
    trigger.config?.authentication_required;

  const getTriggerTypeIcon = () => {
    switch (trigger.trigger_type) {
      case TriggerType.Schedule:
        return <AlarmClockIcon className="w-3.5 h-3.5" />;
      case TriggerType.Webhook:
        return <WebhookIcon className="w-3.5 h-3.5" />;
      case TriggerType.Slack:
        return <MessageSquare className="w-3.5 h-3.5" />;
      default:
        return <Clock className="w-3.5 h-3.5" />;
    }
  };

  const getTriggerTypeLabel = () => {
    switch (trigger.trigger_type) {
      case TriggerType.Schedule:
        return t('triggers.schedule-trigger');
      case TriggerType.Webhook:
        return t('triggers.webhook-trigger');
      case TriggerType.Slack:
        return t('triggers.slack-trigger');
      default:
        return trigger.trigger_type;
    }
  };

  const formatLastExecution = (dateString?: string) => {
    if (!dateString) return t('triggers.never');
    return formatDateTime(dateString, 'HH:mm MMM dd');
  };

  return (
    <div
      onClick={() => onSelect(trigger.id)}
      className={`group gap-3 p-3 bg-surface-primary rounded-xl flex cursor-pointer items-center border transition-all duration-200 ${
        isSelected
          ? 'border-border-action bg-surface-tertiary'
          : needsAuth
            ? 'border-yellow-500 hover:border-yellow-600 hover:bg-surface-tertiary'
            : 'border-border-tertiary hover:border-border-secondary hover:bg-surface-tertiary'
      }`}
    >
      {/* 1. Zap Icon */}
      <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex flex-shrink-0 items-center justify-center">
        <Zap className="w-5 h-5 text-icon-primary" />
      </div>

      {/* 2. Trigger Name + Task Prompt */}
      <div className="min-w-0 flex-1">
        <div className="gap-2 flex items-center">
          <div className="text-sm font-semibold text-text-heading group-hover:text-text-action truncate transition-colors">
            {trigger.name}
          </div>
          {needsAuth && (
            <TooltipSimple content={t('triggers.verification-required')}>
              <div className="p-1 bg-yellow-100 flex items-center justify-center rounded-full">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
              </div>
            </TooltipSimple>
          )}
        </div>
        <div className="text-xs text-text-label mt-0.5 truncate">
          {trigger.task_prompt ||
            trigger.description ||
            t('triggers.no-task-prompt')}
        </div>
      </div>

      {/* 3. Trigger Type */}
      <div className="gap-1.5 text-xs text-text-label flex min-w-[80px] items-center">
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
            onCheckedChange={() => onToggleActive(trigger)}
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
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              onEdit(trigger);
            }}
          >
            <Edit className="h-4 w-4" />
            {t('triggers.edit')}
          </DropdownMenuItem>
          {/* TODO: Support Duplicate Action */}
          {/* <DropdownMenuItem className="gap-2" onSelect={(e) => { e.preventDefault(); onDuplicate(trigger.id); }}>
                        <Copy className="h-4 w-4" />
                        {t("triggers.duplicate")}
                    </DropdownMenuItem> */}
          <DropdownMenuItem
            className="gap-2 text-red-600 focus:text-red-600"
            onSelect={(e) => {
              e.preventDefault();
              onDelete(trigger);
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
