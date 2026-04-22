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

import { SessionSidePanelHeader } from '@/components/Session/SessionSidePanelHeader';
import { SingleAgentSidePanel } from '@/components/Session/SingleAgent/SingleAgentSidePanel';
import { WorkforceSidePanel } from '@/components/Session/Workforce/WorkforceSidePanel';
import { WorkforceSidePanelHeaderEnd } from '@/components/Session/Workforce/WorkforceSidePanelHeaderEnd';
import { SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS } from '@/components/Session/sessionSidePanelLayout';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SessionSidePanelProps {
  mode: SessionModeType;
  workforcePanelKey: string;
  hasAnyMessages: boolean;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

export function SessionSidePanel({
  mode,
  workforcePanelKey,
  hasAnyMessages,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: SessionSidePanelProps) {
  const { t } = useTranslation();
  const isFolded = !isSidePanelVisible;

  const headerTitle =
    mode === SessionMode.WORKFORCE
      ? t('layout.aiWorkforce')
      : t('layout.workspace-session-single-agent');

  const expandFoldedTooltip =
    mode === SessionMode.WORKFORCE
      ? t('layout.show-workforce-panel', {
          defaultValue: 'Show workforce panel',
        })
      : t('layout.show-side-panel', {
          defaultValue: 'Show side panel',
        });

  return (
    <div className="group min-h-0 relative h-full w-full overflow-hidden">
      {/* Full logical width; outer #session-side-panel clips to 40px when folded */}
      <div
        className={cn(
          'min-h-0 flex h-full flex-shrink-0 flex-col overflow-hidden',
          SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS,
          isFolded &&
            'pointer-events-none opacity-40 transition-opacity duration-200 group-hover:opacity-80'
        )}
      >
        <SessionSidePanelHeader
          title={headerTitle}
          mode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggleSidePanel}
          end={
            mode === SessionMode.WORKFORCE ? (
              <WorkforceSidePanelHeaderEnd
                isExpandedOverlayOpen={isExpandedOverlayOpen}
                onToggleExpandedOverlay={onToggleExpandedOverlay}
              />
            ) : null
          }
        />

        {mode === SessionMode.WORKFORCE ? (
          <WorkforceSidePanel
            workforcePanelKey={workforcePanelKey}
            hasAnyMessages={hasAnyMessages}
            isSidePanelVisible={isSidePanelVisible}
            onToggleSidePanel={onToggleSidePanel}
            isExpandedOverlayOpen={isExpandedOverlayOpen}
            onToggleExpandedOverlay={onToggleExpandedOverlay}
            onCloseExpandedOverlay={onCloseExpandedOverlay}
          />
        ) : (
          <SingleAgentSidePanel />
        )}
      </div>

      {isFolded && (
        <TooltipSimple content={expandFoldedTooltip} side="left">
          <button
            type="button"
            onClick={onToggleSidePanel}
            aria-label={expandFoldedTooltip}
            aria-expanded={isSidePanelVisible}
            aria-controls="session-side-panel"
            className={cn(
              'focus-visible:ring-ds-border-neutral-strong-default inset-0 absolute z-20 flex items-center justify-center',
              'p-0 cursor-pointer border-0 bg-transparent outline-none',
              'focus-visible:ring-offset-ds-bg-neutral-default-default focus-visible:ring-2 focus-visible:ring-offset-1',
              'text-ds-text-neutral-default-default'
            )}
          >
            <ChevronLeft
              className="h-4 w-4 pointer-events-none shrink-0"
              aria-hidden
            />
          </button>
        </TooltipSimple>
      )}
    </div>
  );
}
