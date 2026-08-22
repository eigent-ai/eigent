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
import { TooltipSimple } from '@/components/ui/tooltip';
import type { RunNavLeadPresentation } from '@/lib/runNavLead';
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface RunNavItem {
  runId: string;
  title: string;
  runLead: RunNavLeadPresentation;
  source?: 'user' | 'trigger';
  trailing?: string;
}

export interface RunNavRowsProps {
  runs: RunNavItem[];
  activeRunId?: string | null;
  onRunClick: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
}

function RunNavRow({
  run,
  active,
  onRunClick,
  onDeleteRun,
}: {
  run: RunNavItem;
  active: boolean;
  onRunClick: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const LeadIcon = run.runLead.Icon;
  const selected = active || menuOpen;
  const triggerSourceLabel = t('layout.task-source-trigger');
  const moreLabel = t('layout.more-actions');
  const deleteLabel = t('layout.delete-run', { defaultValue: 'Delete run' });

  return (
    <TooltipSimple
      content={run.title}
      side="right"
      align="start"
      sideOffset={4}
      avoidCollisions={false}
      variant="instant"
      enabled={!menuOpen}
    >
      <div
        className={cn(
          'group/run-item relative flex h-8 w-full min-w-0 items-center overflow-hidden rounded-xl pl-3 pr-3',
          'transition-colors duration-150',
          selected
            ? 'bg-ds-bg-neutral-muted-default hover:bg-ds-bg-neutral-default-default'
            : 'bg-transparent hover:bg-ds-bg-neutral-default-default'
        )}
      >
        <button
          type="button"
          onClick={() => onRunClick(run.runId)}
          className={cn(
            'no-drag relative z-0 flex min-h-0 min-w-0 flex-1 items-center gap-3 overflow-hidden px-0 py-1 text-left outline-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default'
          )}
          aria-current={active ? 'true' : undefined}
        >
          <LeadIcon
            className={cn(
              'h-4 w-4 shrink-0',
              run.runLead.iconClassName,
              run.runLead.spin && 'animate-spin'
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ds-text-neutral-muted-default">
            {run.title}
          </span>
          {run.source === 'trigger' ? (
            <AUTOMATION_ICON
              className="h-3.5 w-3.5 shrink-0 text-ds-icon-warning-default-default"
              aria-label={triggerSourceLabel}
            />
          ) : null}
          {run.trailing ? (
            <span className="shrink-0 pl-1 text-body-xs tabular-nums text-ds-text-neutral-muted-default">
              {run.trailing}
            </span>
          ) : null}
        </button>

        <div
          className={cn(
            'pointer-events-none flex max-w-0 shrink-0 items-center justify-end overflow-hidden opacity-0',
            'group-hover/run-item:pointer-events-auto group-hover/run-item:max-w-10 group-hover/run-item:opacity-100',
            'focus-within:pointer-events-auto focus-within:max-w-10 focus-within:opacity-100',
            menuOpen && 'pointer-events-auto max-w-10 opacity-100'
          )}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonRadius="full"
                buttonContent="icon-only"
                className="no-drag shrink-0 data-[state=open]:bg-ds-bg-neutral-subtle-selected"
                aria-label={moreLabel}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={6}
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem
                className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default [&>svg]:text-ds-icon-error-default-default"
                onSelect={() => onDeleteRun(run.runId)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {deleteLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipSimple>
  );
}

export function RunNavRows({
  runs,
  activeRunId,
  onRunClick,
  onDeleteRun,
}: RunNavRowsProps) {
  return runs.map((run) => (
    <RunNavRow
      key={run.runId}
      run={run}
      active={activeRunId === run.runId}
      onRunClick={onRunClick}
      onDeleteRun={onDeleteRun}
    />
  ));
}
