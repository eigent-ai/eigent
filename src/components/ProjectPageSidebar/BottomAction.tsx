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
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CircleHelp } from 'lucide-react';
import type { CSSProperties } from 'react';

import { WORKSPACE_TAB_LABEL_CLASS, workspaceTabButtonClass } from './NavTab';

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
  /** Visible row label (matches workspace `NavTab` label typography). */
  helpLabel: string;
  /** Tooltip on hover; defaults to {@link helpAriaLabel}. */
  helpTooltip?: string;
  onContactSupport: () => void;
  onReportBug: () => void;
  onDownloadLogs: () => void;
  contactSupportLabel: string;
  reportBugLabel: string;
  downloadLogsLabel: string;
}

/** Bottom rail: help menu, then model summary — stacked vertically; folded rail shows icon-only rows. */
export function BottomAction({
  collapsed,
  onOpenModels,
  modelsAriaLabel,
  modelModeLine,
  modelDetailLine,
  helpMenuOpen,
  onHelpMenuOpenChange,
  helpAriaLabel,
  helpLabel,
  helpTooltip,
  onContactSupport,
  onReportBug,
  onDownloadLogs,
  contactSupportLabel,
  reportBugLabel,
  downloadLogsLabel,
}: BottomActionProps) {
  const modelTitle = `${modelModeLine}\n${modelDetailLine}`;
  const helpTooltipText = helpTooltip ?? helpAriaLabel;

  return (
    <div className="border-border-secondary pt-2 mt-auto w-full shrink-0 border-t">
      <div className="min-w-0 gap-1 flex w-full flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 flex w-full">
          <DropdownMenu open={helpMenuOpen} onOpenChange={onHelpMenuOpenChange}>
            <TooltipSimple
              content={helpTooltipText}
              side="right"
              align="center"
              enabled={!helpMenuOpen}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={workspaceTabButtonClass(helpMenuOpen)}
                  aria-label={helpAriaLabel}
                  aria-haspopup="menu"
                >
                  <CircleHelp
                    className="h-4 w-4 text-icon-primary shrink-0"
                    aria-hidden
                  />
                  <span className={WORKSPACE_TAB_LABEL_CLASS}>{helpLabel}</span>
                </button>
              </DropdownMenuTrigger>
            </TooltipSimple>
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

        <div className="min-h-0 min-w-0 flex w-full">
          <TooltipSimple
            content={modelTitle}
            side="right"
            align="center"
            enabled={collapsed}
          >
            <button
              type="button"
              onClick={onOpenModels}
              title={collapsed ? modelTitle : undefined}
              className={cn(
                workspaceTabButtonClass(false),
                'min-h-8 py-1.5 bg-surface-primary h-auto w-full items-center'
              )}
              aria-label={modelsAriaLabel}
            >
              <span
                className="h-4 w-4 flex shrink-0 items-center justify-center"
                aria-hidden
              >
                <img
                  src={folderIcon}
                  alt=""
                  className="h-4 w-4 shrink-0 object-contain"
                  draggable={false}
                />
              </span>
              <div className="min-w-0 gap-0.5 flex flex-1 flex-col justify-center text-left leading-none">
                <div className="bg-surface-information min-w-0 rounded-md px-1 w-fit max-w-full">
                  <span className="text-text-information text-label-xs font-semibold leading-tight block truncate">
                    {modelModeLine}
                  </span>
                </div>
                <span className="text-text-secondary leading-tight truncate text-left text-[10px]">
                  {modelDetailLine}
                </span>
              </div>
            </button>
          </TooltipSimple>
        </div>
      </div>
    </div>
  );
}
