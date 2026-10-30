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

import { WorkspaceTab, type SessionPreviewOpening } from '@/store/pageTabStore';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface UsePreviewEntranceOptions {
  showPreview: boolean;
  /** Preview scope: the Session's Project id or the New session draft. */
  scopeId: string | null;
  activeWorkspaceTab: string;
  previewOpening: SessionPreviewOpening | null;
  shouldReduceMotion: boolean;
}

/**
 * Track when the Preview column's geometry has settled for the current open
 * cycle. Embedded browser guests are `position: fixed` in a separate layer, so
 * the column's animated bounds can't clip them: hold the guest parked until the
 * entrance finishes, then it fades in over the settled rect. Immediate and
 * reduced-motion openings settle after the first layout frame.
 */
export function usePreviewEntrance({
  showPreview,
  scopeId,
  activeWorkspaceTab,
  previewOpening,
  shouldReduceMotion,
}: UsePreviewEntranceOptions) {
  const immediateOpening = Boolean(
    previewOpening?.projectId === scopeId && previewOpening?.immediate
  );
  const immediateGeometry = shouldReduceMotion || immediateOpening;
  const openingCycle = useMemo(
    () => ({
      showPreview,
      scopeId,
      activeWorkspaceTab,
      previewOpening,
    }),
    [showPreview, scopeId, activeWorkspaceTab, previewOpening]
  );
  const activeOpeningCycleRef = useRef<object | null>(null);
  const [settledOpeningCycle, setSettledOpeningCycle] = useState<object | null>(
    null
  );
  const displaySettled = showPreview && settledOpeningCycle === openingCycle;

  useLayoutEffect(() => {
    if (
      !showPreview ||
      (activeWorkspaceTab !== WorkspaceTab.Project &&
        activeWorkspaceTab !== WorkspaceTab.NewProject)
    )
      return;
    activeOpeningCycleRef.current = openingCycle;
    const frame = immediateGeometry
      ? window.requestAnimationFrame(() => {
          if (activeOpeningCycleRef.current === openingCycle) {
            setSettledOpeningCycle(openingCycle);
          }
        })
      : null;
    return () => {
      activeOpeningCycleRef.current = null;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [showPreview, activeWorkspaceTab, openingCycle, immediateGeometry]);

  const finishEntrance = () => {
    if (!immediateGeometry && activeOpeningCycleRef.current === openingCycle) {
      setSettledOpeningCycle(openingCycle);
    }
  };

  return {
    immediateOpening,
    immediateGeometry,
    displaySettled,
    finishEntrance,
  };
}
