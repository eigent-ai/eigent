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
import { motion } from 'framer-motion';
import { Power } from 'lucide-react';

import {
  PROJECT_SIDEBAR_FOLD_SPRING,
  SIDEBAR_TOOLTIP_CONTENT_CLASS,
} from './constants';
import { WORKSPACE_TAB_LABEL_CLASS, workspaceTabButtonClass } from './NavTab';

export interface BottomActionProps {
  /** When false, the bottom rail is omitted entirely. */
  showEndProject: boolean;
  endProjectLabel: string;
  endProjectAriaLabel: string;
  /** Tooltip content; defaults to {@link endProjectLabel}. */
  endProjectTooltip?: string;
  onEndProjectClick: () => void;
  /** Icon-only rail: fade label; keep Power icon fixed. */
  folded?: boolean;
}

/** Bottom rail: end project — same layout as the former help row (icon + label, workspace tab button styles). */
export function BottomAction({
  showEndProject,
  endProjectLabel,
  endProjectAriaLabel,
  endProjectTooltip,
  onEndProjectClick,
  folded = false,
}: BottomActionProps) {
  const tooltipText = endProjectTooltip ?? endProjectLabel;

  if (!showEndProject) {
    return null;
  }

  return (
    <div className="pt-2 mt-auto w-full shrink-0">
      <div className="min-w-0 gap-1 flex w-full flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 flex w-full">
          <TooltipSimple
            content={tooltipText}
            side="right"
            align="center"
            enabled={folded}
            className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
          >
            <button
              type="button"
              onClick={onEndProjectClick}
              className={cn(
                workspaceTabButtonClass(false),
                'bg-ds-bg-error-subtle-default hover:bg-ds-bg-status-error-subtle-hover active:bg-ds-bg-status-error-subtle-active',
                folded && 'gap-0'
              )}
              aria-label={endProjectAriaLabel}
            >
              <Power
                className="h-4 w-4 !text-ds-icon-error-default-default shrink-0"
                aria-hidden
              />
              <motion.span
                className="min-w-0 flex-1 overflow-hidden"
                initial={false}
                animate={{
                  opacity: folded ? 0 : 1,
                  maxWidth: folded ? 0 : 1600,
                }}
                transition={PROJECT_SIDEBAR_FOLD_SPRING}
                aria-hidden={folded}
              >
                <span
                  className={cn(
                    WORKSPACE_TAB_LABEL_CLASS,
                    'font-medium text-body-sm !text-ds-text-error-default-default'
                  )}
                >
                  {endProjectLabel}
                </span>
              </motion.span>
            </button>
          </TooltipSimple>
        </div>
      </div>
    </div>
  );
}
