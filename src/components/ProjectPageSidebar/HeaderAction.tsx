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

import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PanelLeft, PanelLeftClose, Plus } from 'lucide-react';

/** Hub tile shell without whole-area hover (split controls handle their own hover). */
function hubIconTabShellClass(active: boolean): string {
  return cn(
    'no-drag w-full min-w-0 rounded-xl bg-surface-primary transition-colors',
    active && 'bg-surface-tertiary'
  );
}

export interface HeaderActionProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  expandAriaLabel: string;
  expandTooltip: string;
  collapseAriaLabel: string;
  collapseTooltip: string;
  historySidebarOpen: boolean;
  activeTaskTitle: string;
  onCenterClick: () => void;
  newProjectAriaLabel: string;
  newProjectTooltip: string;
  onNewProject: () => void;
}

/** Project sidebar top bar: collapse | active title | new project (or expand when collapsed). */
export function HeaderAction({
  collapsed,
  onToggleCollapsed,
  expandAriaLabel,
  expandTooltip,
  collapseAriaLabel,
  collapseTooltip,
  historySidebarOpen,
  activeTaskTitle,
  onCenterClick,
  newProjectAriaLabel,
  newProjectTooltip,
  onNewProject,
}: HeaderActionProps) {
  if (collapsed) {
    return (
      <TooltipSimple content={expandTooltip} side="right" align="center">
        <button
          type="button"
          className={cn(
            'no-drag h-8 min-h-8 rounded-xl flex w-full shrink-0 cursor-pointer items-center justify-start',
            'hover:bg-surface-tertiary border-0 bg-transparent',
            'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none',
            'px-3'
          )}
          onClick={onToggleCollapsed}
          aria-label={expandAriaLabel}
        >
          <PanelLeft
            className="h-4 w-4 text-icon-primary shrink-0"
            aria-hidden
          />
        </button>
      </TooltipSimple>
    );
  }

  return (
    <div className="min-w-0 flex items-stretch">
      <div
        className={cn(
          hubIconTabShellClass(historySidebarOpen),
          'h-8 min-h-8 min-w-0 flex flex-1 flex-row overflow-hidden'
        )}
      >
        <TooltipSimple content={collapseTooltip} side="bottom" align="start">
          <button
            type="button"
            className={cn(
              'no-drag min-h-0 w-10 flex h-full shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent transition-colors',
              historySidebarOpen
                ? 'hover:brightness-[0.98]'
                : 'hover:bg-surface-tertiary',
              'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
            )}
            onClick={onToggleCollapsed}
            aria-label={collapseAriaLabel}
          >
            <PanelLeftClose
              className="h-4 w-4 text-icon-primary shrink-0"
              aria-hidden
            />
          </button>
        </TooltipSimple>
        <TooltipSimple content={activeTaskTitle} side="bottom" align="center">
          <button
            id="sidebar-active-task-title-btn"
            type="button"
            className={cn(
              'no-drag min-h-0 min-w-0 border-border-tertiary flex h-full flex-1 cursor-pointer items-center border-x border-t border-b-0 border-solid bg-transparent text-left transition-colors',
              historySidebarOpen
                ? 'hover:brightness-[0.98]'
                : 'hover:bg-surface-tertiary',
              'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
            )}
            onClick={onCenterClick}
            aria-expanded={historySidebarOpen}
            aria-haspopup="dialog"
          >
            <span className="min-w-0 text-text-body text-body-sm font-bold flex-1 truncate">
              {activeTaskTitle}
            </span>
          </button>
        </TooltipSimple>
        <TooltipSimple content={newProjectTooltip} side="bottom" align="end">
          <button
            type="button"
            className={cn(
              'no-drag w-10 flex h-full shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent transition-colors',
              historySidebarOpen
                ? 'hover:brightness-[0.98]'
                : 'hover:bg-surface-tertiary',
              'focus-visible:ring-border-secondary focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
            )}
            onClick={onNewProject}
            aria-label={newProjectAriaLabel}
          >
            <Plus className="h-4 w-4 text-icon-primary shrink-0" aria-hidden />
          </button>
        </TooltipSimple>
      </div>
    </div>
  );
}
