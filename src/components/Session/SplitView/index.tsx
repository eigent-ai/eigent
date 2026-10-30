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

import Session from '@/components/Session';
import { CHAT_MIN_WIDTH } from '@/components/Session/layout/sessionColumns';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useVisibleSessionPanes } from '@/hooks/useSessionSplitView';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSpaceStore } from '@/store/spaceStore';
import { X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The Session view of a Space: one Session, or up to three side by side when
 * the focused Session belongs to the Space's split.
 */
export function SessionSplitView() {
  const { t } = useTranslation();
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const spaceId = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId)?.spaceId : null
  );
  const panes = useVisibleSessionPanes(spaceId);
  const closePane = useSessionSplitViewStore((s) => s.closePane);
  const split =
    panes.length >= 2 &&
    Boolean(activeProjectId) &&
    panes.includes(activeProjectId!);

  // Panes other than the focused one hydrate too. A history load selects the
  // Session it loads, so give focus back unless the user moved it meanwhile.
  useEffect(() => {
    if (!split || !activeProjectId) return;
    const focusedId = activeProjectId;
    const projectStore = useProjectRuntimeStore.getState();
    for (const id of panes) {
      if (id === focusedId) continue;
      void ensureProjectRuntimeLoaded(projectStore, id, {
        requireActiveSelection: false,
      }).then(() => {
        const runtime = useProjectRuntimeStore.getState();
        if (runtime.activeProjectId === id) runtime.setActiveProject(focusedId);
      });
    }
    // Hydrate when the panes change, not on every focus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, split]);

  if (!split || !spaceId) return <Session />;

  return (
    <SessionSplitPanes
      spaceId={spaceId}
      panes={panes}
      activeProjectId={activeProjectId!}
      closeLabel={t('layout.close-pane', { defaultValue: 'Close pane' })}
      onClose={(projectId) => {
        const index = panes.indexOf(projectId);
        const remaining = panes.filter((id) => id !== projectId);
        closePane(spaceId, projectId);
        // The neighbour on the left takes focus; the first pane hands it right.
        if (projectId === activeProjectId)
          useProjectRuntimeStore
            .getState()
            .setActiveProject(remaining[Math.max(0, index - 1)] ?? null);
      }}
    />
  );
}

/**
 * Panes side by side with drag handles between them. Sizes are saved per Space
 * and set of panes; a pane never gets narrower than the chat column.
 */
function SessionSplitPanes({
  spaceId,
  panes,
  activeProjectId,
  closeLabel,
  onClose,
}: {
  spaceId: string;
  panes: string[];
  activeProjectId: string;
  closeLabel: string;
  onClose: (projectId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Panel sizes are percentages; convert the chat minimum from pixels.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const equalShare = 100 / panes.length;
  const minSize =
    width > 0 ? Math.min(equalShare, (CHAT_MIN_WIDTH / width) * 100) : 10;

  return (
    // Pane geometry is measured layout under the split-pane-geometry exception.
    <div
      ref={containerRef}
      data-session-split-view
      className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden"
    >
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId={`eigent-session-split:${spaceId}:${panes.length}`}
      >
        {panes.map((projectId, index) => (
          <Fragment key={projectId}>
            {index > 0 ? <ResizableHandle /> : null}
            <ResizablePanel
              id={projectId}
              order={index}
              defaultSize={equalShare}
              minSize={minSize}
              data-session-split-pane={projectId}
              data-focused={projectId === activeProjectId ? 'true' : undefined}
              className="flex h-full min-h-0 min-w-0 flex-col"
            >
              <Session
                projectId={projectId}
                headerActions={
                  <TooltipSimple
                    content={closeLabel}
                    variant="instant"
                    side="bottom"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className="no-drag shrink-0 text-ds-ink-muted-default"
                      aria-label={closeLabel}
                      onClick={() => onClose(projectId)}
                    >
                      <DsIcon icon={X} aria-hidden />
                    </Button>
                  </TooltipSimple>
                }
              />
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </div>
  );
}
