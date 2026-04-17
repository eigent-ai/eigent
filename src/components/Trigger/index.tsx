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

import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTriggerStore } from '@/store/triggerStore';
import {
  ArrowUpDown,
  Plus,
  SquareChevronRight,
  SquareCode,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Overview, { sortTriggersList, type TriggerSortKey } from './Triggers';

type TriggerPanelProps = {
  className?: string;
  sortBy: TriggerSortKey;
  onSortByChange: (sortBy: TriggerSortKey) => void;
  selectedTriggerId: number | null;
  onSelectedTriggerIdChange: (id: number | null) => void;
  isExecutionLogsOpen: boolean;
  onExecutionLogsOpenChange: (open: boolean) => void;
  isDialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
};

export default function TriggerPanel({
  className,
  sortBy,
  onSortByChange,
  selectedTriggerId,
  onSelectedTriggerIdChange,
  isExecutionLogsOpen,
  onExecutionLogsOpenChange,
  isDialogOpen,
  onDialogOpenChange,
}: TriggerPanelProps) {
  const { t } = useTranslation();
  const { wsConnectionStatus, triggers } = useTriggerStore();

  const sortedTriggersForHeader = useMemo(
    () => sortTriggersList(triggers, sortBy),
    [triggers, sortBy]
  );

  const triggerSortLabel = useMemo(() => {
    switch (sortBy) {
      case 'createdAt':
        return t('triggers.created-time');
      case 'lastExecutionTime':
        return t('triggers.last-execution-label');
      case 'tokens':
        return t('triggers.token-cost');
      default:
        return t('triggers.created-time');
    }
  }, [sortBy, t]);

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex h-full w-full flex-col overflow-hidden',
        className
      )}
    >
      <div className="gap-2 px-2 py-2 flex w-full shrink-0 items-center justify-between">
        <div className="text-text-heading min-w-0 gap-2 px-1 text-body-md font-bold flex flex-1 items-center">
          <span className="truncate">{t('triggers.title')}</span>
        </div>
        <div className="gap-2 flex shrink-0 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                buttonContent="text"
                size="sm"
                className="rounded-lg"
              >
                {triggerSortLabel}
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSortByChange('createdAt')}>
                {t('triggers.created-time')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSortByChange('lastExecutionTime')}
              >
                {t('triggers.last-execution-label')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="primary"
            size="sm"
            className="rounded-lg items-center justify-center"
            onClick={() => onDialogOpenChange(true)}
          >
            <Plus />
            {t('triggers.create')}
          </Button>
          <TooltipSimple
            content={
              isExecutionLogsOpen
                ? t('triggers.fold-execution-logs')
                : t('triggers.open-execution-logs')
            }
            delayDuration={300}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="opacity-70"
              disabled={sortedTriggersForHeader.length === 0}
              onClick={() => {
                if (isExecutionLogsOpen) {
                  onExecutionLogsOpenChange(false);
                  return;
                }

                if (!selectedTriggerId && sortedTriggersForHeader.length > 0) {
                  onSelectedTriggerIdChange(sortedTriggersForHeader[0].id);
                }

                onExecutionLogsOpenChange(true);
              }}
            >
              {isExecutionLogsOpen ? (
                <SquareChevronRight className="h-4 w-4" />
              ) : (
                <SquareCode className="h-4 w-4" />
              )}
            </Button>
          </TooltipSimple>
          <TriggerDialog
            selectedTrigger={null}
            isOpen={isDialogOpen}
            onOpenChange={onDialogOpenChange}
          />
        </div>
      </div>
      <div
        className={cn(
          'min-h-0 w-full flex-1',
          wsConnectionStatus === 'disconnected' &&
            'pointer-events-none opacity-50 grayscale'
        )}
      >
        <Overview
          sortBy={sortBy}
          selectedTriggerId={selectedTriggerId}
          onSelectedTriggerIdChange={onSelectedTriggerIdChange}
          isExecutionLogsOpen={isExecutionLogsOpen}
          onExecutionLogsOpenChange={onExecutionLogsOpenChange}
        />
      </div>
    </div>
  );
}
