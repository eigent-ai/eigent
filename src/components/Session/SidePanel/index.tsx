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

import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { SessionActivityPanel } from '@/components/Session/SidePanel/components/ActivityPanel';
import ExpandedOverlay from '@/components/Session/SidePanel/components/ExpandedOverlay';
import { SidePanelHeader } from '@/components/Session/SidePanel/components/Header';
import { WorkforceHeaderAction } from '@/components/Session/SidePanel/components/WorkforceHeaderAction';
import type { SessionPanelScope } from '@/components/Session/SidePanel/sections/sessionPanelScope';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SessionSidePanelProps {
  mode: SessionModeType;
  workforcePanelKey: string;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

export function SessionSidePanel({
  mode,
  workforcePanelKey,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: SessionSidePanelProps) {
  const { t } = useTranslation();
  const isFolded = !isSidePanelVisible;
  const [scope, setScope] = useState<SessionPanelScope>('latest');

  const headerTitle = t('layout.session-summary', {
    defaultValue: 'Summary',
  });
  const scopeLabel = t('layout.session-summary-scope', {
    defaultValue: 'Summary content',
  });
  const latestOnlyLabel = t('layout.session-summary-latest-only', {
    defaultValue: 'Latest only',
  });
  const allLabel = t('layout.session-summary-all', {
    defaultValue: 'All',
  });

  const expandFoldedTooltip = t('layout.show-side-panel', {
    defaultValue: 'Show side panel',
  });

  return (
    <div className="group relative h-full min-h-0 w-full overflow-hidden">
      {/* Full logical width; outer #session-side-panel clips to 40px when folded */}
      <div
        className={cn(
          'flex h-full min-h-0 shrink-0 flex-col overflow-hidden',
          RIGHT_RAIL_CONTENT_WIDTH_CLASS,
          isFolded &&
            'pointer-events-none opacity-40 transition-opacity duration-200 group-hover:opacity-80'
        )}
      >
        <SidePanelHeader
          title={headerTitle}
          mode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggleSidePanel}
          end={
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === 'latest' || value === 'all') setScope(value);
              }}
            >
              <SelectTrigger
                size="sm"
                variant="secondary"
                aria-label={scopeLabel}
                wrapperClassName="w-fit max-w-full"
                className="h-7 w-auto justify-center gap-0 rounded-lg border-transparent px-2 !text-ds-text-meta [&>svg]:hidden"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="latest">{latestOnlyLabel}</SelectItem>
                <SelectItem value="all">{allLabel}</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        {/* Sizes to its content and only shrinks (then scrolls inside) once the
            sections outgrow the column. */}
        <div className="mx-1 mb-1 flex min-h-0 flex-col overflow-hidden rounded-2xl bg-ds-neutral-default-default pl-2">
          <SessionActivityPanel
            scope={scope}
            agentHeaderAction={
              mode === SessionMode.WORKFORCE ? (
                <WorkforceHeaderAction
                  isExpandedOverlayOpen={isExpandedOverlayOpen}
                  onToggleExpandedOverlay={onToggleExpandedOverlay}
                />
              ) : undefined
            }
          />
        </div>
      </div>

      {mode === SessionMode.WORKFORCE ? (
        <ExpandedOverlay
          open={isExpandedOverlayOpen}
          onClose={onCloseExpandedOverlay}
          workforcePanelKey={workforcePanelKey}
          onToggleSidePanel={onToggleSidePanel}
          isSidePanelVisible={isSidePanelVisible}
        />
      ) : null}

      {isFolded && (
        <TooltipSimple
          content={
            <ShortcutTooltipContent
              label={expandFoldedTooltip}
              shortcutId="toggle-session-side-panel"
            />
          }
          compact
          side="left"
          variant="instant"
        >
          <button
            type="button"
            onClick={onToggleSidePanel}
            aria-label={expandFoldedTooltip}
            aria-expanded={isSidePanelVisible}
            aria-controls="session-side-panel"
            className={cn(
              'absolute inset-0 z-20 flex items-center justify-center focus-visible:ring-ds-hairline-strong-default',
              'cursor-pointer border-0 border-x-0 border-y-0 bg-transparent p-0 outline-none',
              'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-ds-neutral-default-default',
              'text-ds-ink-default-default'
            )}
          >
            <ChevronLeft
              className="pointer-events-none h-4 w-4 shrink-0"
              aria-hidden
            />
          </button>
        </TooltipSimple>
      )}
    </div>
  );
}
