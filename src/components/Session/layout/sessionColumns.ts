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

// Measured Session column geometry: registered split-pane-geometry exception.

/** Smallest the chat timeline (and the resizable chat side) may be. */
export const CHAT_MIN_WIDTH = 360;
/** Keep at least this much room for Preview content when the chat side widens. */
export const PREVIEW_MIN_WIDTH = 320;
/** Fixed width of the docked Summary (Activity) column. */
export const SUMMARY_WIDTH = 360;
/** Preview owns a single thin left border. */
export const PREVIEW_BORDER_WIDTH = 1;
/** Chat side width needed to dock Summary beside the timeline. */
export const SUMMARY_DOCK_MIN_WIDTH = CHAT_MIN_WIDTH + SUMMARY_WIDTH;
/** Pane width needed to keep Preview open beside the chat minimum. */
export const PREVIEW_PANE_MIN_WIDTH =
  CHAT_MIN_WIDTH + PREVIEW_MIN_WIDTH + PREVIEW_BORDER_WIDTH;
/** Keyboard resize step for the Preview divider. */
export const RESIZE_KEYBOARD_STEP = 16;

export function getMaxChatSideWidth(paneWidth: number) {
  return Math.max(
    CHAT_MIN_WIDTH,
    paneWidth - PREVIEW_MIN_WIDTH - PREVIEW_BORDER_WIDTH
  );
}

export function clampChatSideWidth(width: number, maxWidth: number) {
  return Math.max(CHAT_MIN_WIDTH, Math.min(maxWidth, width));
}

export interface SessionColumnLayoutInput {
  /** Measured Session row width; `null` before the first measurement. */
  paneWidth: number | null;
  /** Fallback width used before measurement (the window width). */
  fallbackPaneWidth: number;
  previewOpen: boolean;
  /** Saved Summary preference, used to size the chat side on first open. */
  summaryOpen: boolean;
  /** Last committed chat side width; `null` until the user resizes. */
  chatSideWidth: number | null;
}

export interface SessionColumnLayout {
  showPreview: boolean;
  maxChatSideWidth: number;
  visibleChatSideWidth: number;
  canDockSummary: boolean;
}

/**
 * Resolve which optional columns fit. Preview closes when the pane cannot keep
 * both minimums; Summary docks only when the chat side can hold it beside the
 * timeline minimum, and otherwise opens as a popover over chat.
 */
export function getSessionColumnLayout({
  paneWidth,
  fallbackPaneWidth,
  previewOpen,
  summaryOpen,
  chatSideWidth,
}: SessionColumnLayoutInput): SessionColumnLayout {
  const showPreview =
    previewOpen && (paneWidth === null || paneWidth >= PREVIEW_PANE_MIN_WIDTH);
  const maxChatSideWidth = getMaxChatSideWidth(paneWidth ?? fallbackPaneWidth);
  const visibleChatSideWidth = Math.min(
    chatSideWidth ?? CHAT_MIN_WIDTH + (summaryOpen ? SUMMARY_WIDTH : 0),
    maxChatSideWidth
  );
  const canDockSummary =
    (showPreview ? visibleChatSideWidth : (paneWidth ?? Infinity)) >=
    SUMMARY_DOCK_MIN_WIDTH;
  return {
    showPreview,
    maxChatSideWidth,
    visibleChatSideWidth,
    canDockSummary,
  };
}
