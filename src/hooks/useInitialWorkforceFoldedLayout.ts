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

import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react';
import {
  getPanelGroupElement,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

export const WORKFORCE_FOLDED_MIN_PX = 300;
export const WORKFORCE_FOLDED_MAX_PX = 420;
const WORKFORCE_FOLDED_TARGET_PX = 360;

/**
 * Sizes the workforce (main) panel to ~360px as a percentage of the panel
 * group when the chat is visible alongside the workforce tab.
 */
export function useInitialWorkforceFoldedLayout(
  panelGroupId: string,
  workforcePanelRef: RefObject<ImperativePanelHandle | null>,
  enabled: boolean,
  /** When false, callers should ignore transient wide layouts before init resize runs. */
  autoExpandGateRef: MutableRefObject<boolean>,
  resetKey?: string | number | boolean
): void {
  useLayoutEffect(() => {
    if (!enabled) {
      autoExpandGateRef.current = false;
      return;
    }
    autoExpandGateRef.current = false;
    const groupEl = getPanelGroupElement(panelGroupId);
    if (!groupEl) return;
    const w = groupEl.getBoundingClientRect().width;
    if (w <= 0) return;
    const minPct = (WORKFORCE_FOLDED_MIN_PX / w) * 100;
    const maxPct = (WORKFORCE_FOLDED_MAX_PX / w) * 100;
    const targetPct = (WORKFORCE_FOLDED_TARGET_PX / w) * 100;
    const pct = Math.min(maxPct, Math.max(minPct, targetPct));
    workforcePanelRef.current?.resize(pct);
    queueMicrotask(() => {
      autoExpandGateRef.current = true;
    });
  }, [panelGroupId, enabled, resetKey, workforcePanelRef, autoExpandGateRef]);
}
