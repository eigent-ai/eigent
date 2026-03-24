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

import { useLayoutEffect, type RefObject } from 'react';
import {
  getPanelGroupElement,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

const CHAT_PANEL_DEFAULT_PX = 400;
const CHAT_PANEL_MIN_PX = 360;

/**
 * On mount (and when resetKey changes), sizes the chat panel to ~400px as a
 * percentage of the panel group width. ChatBox stays w-full inside the panel
 * with min-w-[360px]; user drag can grow the panel beyond 400px.
 */
export function useInitialChatPanelLayout(
  panelGroupId: string,
  chatPanelRef: RefObject<ImperativePanelHandle | null>,
  enabled: boolean,
  resetKey?: string | number | boolean
): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const groupEl = getPanelGroupElement(panelGroupId);
    if (!groupEl) return;
    const w = groupEl.getBoundingClientRect().width;
    if (w <= 0) return;
    const targetPct = (CHAT_PANEL_DEFAULT_PX / w) * 100;
    const minPct = (CHAT_PANEL_MIN_PX / w) * 100;
    const pct = Math.min(92, Math.max(minPct, targetPct));
    chatPanelRef.current?.resize(pct);
  }, [panelGroupId, enabled, resetKey, chatPanelRef]);
}
