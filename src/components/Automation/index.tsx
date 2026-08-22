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
import ContentHeader from '@/components/Layout/ContentHeader';
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
import AutomationsOverview, {
  sortAutomationsList,
  type AutomationSortKey,
} from './Automations';

type AutomationPanelProps = {
  className?: string;
  sortBy: AutomationSortKey;
  onSortByChange: (sortBy: AutomationSortKey) => void;
  selectedAutomationId: number | null;
  onSelectedAutomationIdChange: (id: number | null) => void;
  isAutomationRunHistoryOpen: boolean;
  onAutomationRunHistoryOpenChange: (open: boolean) => void;
  isDialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
};

export default function AutomationPanel({
  className,
  sortBy,
  onSortByChange,
  selectedAutomationId,
  onSelectedAutomationIdChange,
  isAutomationRunHistoryOpen,
  onAutomationRunHistoryOpenChange,
  isDialogOpen,
  onDialogOpenChange,
}: AutomationPanelProps) {
  const { t } = useTranslation();
  const { wsConnectionStatus, triggers } = useTriggerStore();

  const sortedAutomationsForHeader = useMemo(
    () => sortAutomationsList(triggers, sortBy),
    [triggers, sortBy]
  );

  const automationSortLabel = useMemo(() => {
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
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      <ContentHeader
        title={t('layout.scheduled-tab')}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  buttonContent="text"
                  size="sm"
                  className="rounded-lg"
                >
                  {automationSortLabel}
                  <ArrowUpDown />
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
              buttonContent="text"
              className="items-center justify-center rounded-lg"
              onClick={() => onDialogOpenChange(true)}
            >
              <Plus />
              {t('triggers.create')}
            </Button>
            <TooltipSimple
              content={
                isAutomationRunHistoryOpen
                  ? t('triggers.fold-execution-logs')
                  : t('triggers.open-execution-logs')
              }
              variant="instant"
              side="bottom"
            >
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                className="rounded-lg opacity-70"
                disabled={sortedAutomationsForHeader.length === 0}
                onClick={() => {
                  if (isAutomationRunHistoryOpen) {
                    onAutomationRunHistoryOpenChange(false);
                    return;
                  }

                  if (
                    !selectedAutomationId &&
                    sortedAutomationsForHeader.length > 0
                  ) {
                    onSelectedAutomationIdChange(
                      sortedAutomationsForHeader[0].id
                    );
                  }

                  onAutomationRunHistoryOpenChange(true);
                }}
              >
                {isAutomationRunHistoryOpen ? (
                  <SquareChevronRight className="h-4 w-4" />
                ) : (
                  <SquareCode className="h-4 w-4" />
                )}
              </Button>
            </TooltipSimple>
            <AutomationDialog
              selectedAutomation={null}
              isOpen={isDialogOpen}
              onOpenChange={onDialogOpenChange}
            />
          </>
        }
      />
      <div
        className={cn(
          'min-h-0 w-full flex-1',
          wsConnectionStatus === 'disconnected' &&
            'pointer-events-none opacity-50 grayscale'
        )}
      >
        <AutomationsOverview
          sortBy={sortBy}
          selectedAutomationId={selectedAutomationId}
          onSelectedAutomationIdChange={onSelectedAutomationIdChange}
          isAutomationRunHistoryOpen={isAutomationRunHistoryOpen}
          onAutomationRunHistoryOpenChange={onAutomationRunHistoryOpenChange}
        />
      </div>
    </div>
  );
}
