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

import folderIcon from '@/assets/Folder.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CircleHelp } from 'lucide-react';
import type { CSSProperties } from 'react';

function hubIconTabClass(active: boolean): string {
  return cn(
    'no-drag h-8 w-full min-w-0 rounded-xl bg-surface-primary',
    'hover:bg-surface-tertiary flex cursor-pointer items-center justify-center transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-secondary',
    active && 'bg-surface-tertiary'
  );
}

const rowButtonBaseClass =
  'no-drag h-8 rounded-xl hover:bg-surface-tertiary min-w-0 flex shrink-0 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-secondary';

const rowButtonClass = cn(rowButtonBaseClass, 'gap-3 px-3 w-full');

const PROJECT_HUB_DROPDOWN_CONTENT_CLASS = cn(
  'min-w-[11rem] -mb-2 flex flex-col gap-1 rounded-xl border-0 bg-fill-default p-1 shadow-md'
);

const PROJECT_HUB_DROPDOWN_CONTENT_STYLE: CSSProperties = {
  border: 'none',
  borderRadius: 'var(--borderRadius-rounded-xl, 12px)',
  background: 'var(--fill-default, #FFF)',
};

const PROJECT_HUB_DROPDOWN_ITEM_CLASS = cn(
  'flex h-9 min-h-9 w-full shrink-0 cursor-pointer select-none items-center rounded-xl px-3 py-0 text-body-sm font-medium text-text-label outline-none',
  'hover:bg-surface-secondary hover:text-text-label',
  'data-[highlighted]:bg-surface-secondary data-[highlighted]:text-text-label',
  'focus:bg-surface-secondary focus:text-text-label'
);

export interface BottomActionProps {
  collapsed: boolean;
  onOpenModels: () => void;
  modelsAriaLabel: string;
  modelModeLine: string;
  modelDetailLine: string;
  helpMenuOpen: boolean;
  onHelpMenuOpenChange: (open: boolean) => void;
  helpAriaLabel: string;
  onContactSupport: () => void;
  onReportBug: () => void;
  onDownloadLogs: () => void;
  contactSupportLabel: string;
  reportBugLabel: string;
  downloadLogsLabel: string;
}

/** Bottom rail: primary model summary cell + help menu, responsive grid. */
export function BottomAction({
  collapsed,
  onOpenModels,
  modelsAriaLabel,
  modelModeLine,
  modelDetailLine,
  helpMenuOpen,
  onHelpMenuOpenChange,
  helpAriaLabel,
  onContactSupport,
  onReportBug,
  onDownloadLogs,
  contactSupportLabel,
  reportBugLabel,
  downloadLogsLabel,
}: BottomActionProps) {
  return (
    <div className="border-border-secondary pt-2 mt-auto w-full shrink-0 border-t">
      <div
        className={cn(
          'min-w-0 gap-1 grid w-full overflow-hidden',
          collapsed ? 'grid-cols-1' : 'grid-cols-[minmax(0,3fr)_minmax(0,1fr)]'
        )}
      >
        <div
          className={cn(
            'min-h-0 min-w-0 overflow-hidden',
            collapsed && 'max-h-0 pointer-events-none overflow-hidden opacity-0'
          )}
        >
          <button
            type="button"
            onClick={onOpenModels}
            title={`${modelModeLine}\n${modelDetailLine}`}
            className={cn(
              rowButtonClass,
              'bg-surface-primary w-full',
              'focus-visible:ring-border-secondary focus-visible:ring-2 focus-visible:outline-none'
            )}
            aria-label={modelsAriaLabel}
          >
            <span
              className="h-7 w-7 flex shrink-0 items-center justify-center"
              aria-hidden
            >
              <img
                src={folderIcon}
                alt=""
                className="h-7 w-7 mt-1 shrink-0 object-contain"
                draggable={false}
              />
            </span>
            <div className="min-w-0 flex flex-1 flex-col justify-center leading-none">
              <div className="bg-surface-information rounded-md px-1 w-fit">
                <span className="text-text-information text-label-xs font-semibold leading-tight truncate text-nowrap">
                  {modelModeLine}
                </span>
              </div>
              <span className="text-text-secondary leading-tight px-1 truncate text-[10px]">
                {modelDetailLine}
              </span>
            </div>
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex w-full">
          <DropdownMenu open={helpMenuOpen} onOpenChange={onHelpMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  hubIconTabClass(helpMenuOpen),
                  collapsed && 'px-3 justify-start'
                )}
                aria-label={helpAriaLabel}
                aria-haspopup="menu"
              >
                <CircleHelp
                  className="h-4 w-4 text-icon-primary shrink-0"
                  aria-hidden
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              alignOffset={8}
              className={PROJECT_HUB_DROPDOWN_CONTENT_CLASS}
              style={PROJECT_HUB_DROPDOWN_CONTENT_STYLE}
            >
              <DropdownMenuItem
                className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                onSelect={onContactSupport}
              >
                {contactSupportLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                onSelect={onReportBug}
              >
                {reportBugLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={PROJECT_HUB_DROPDOWN_ITEM_CLASS}
                onSelect={onDownloadLogs}
              >
                {downloadLogsLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
