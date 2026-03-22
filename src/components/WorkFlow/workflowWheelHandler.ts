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

import type { Viewport } from '@xyflow/react';

export interface WorkflowWheelHandlerOptions {
  isEditMode: boolean;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport, opts?: { duration: number }) => void;
  clampViewportX: (x: number) => number;
}

/**
 * Creates a wheel event handler for the Workflow (Agent Canvas) that:
 * - Handles horizontal scroll (deltaX) from Mac trackpad two-finger swipe
 * - Handles vertical scroll (deltaY) mapped to horizontal pan (carousel style)
 * - Prevents pinch-to-zoom (ctrlKey) from triggering browser zoom when zoom is disabled
 */
export function createWorkflowWheelHandler(
  options: WorkflowWheelHandlerOptions
): (e: WheelEvent) => void {
  const { isEditMode, getViewport, setViewport, clampViewportX } = options;

  return (e: WheelEvent) => {
    if (isEditMode) return;

    // Block zoom gestures (Mac pinch, Windows Ctrl+wheel). Trade-off: disables Ctrl+wheel zoom over canvas.
    if (e.ctrlKey) {
      e.preventDefault();
      return;
    }

    // Horizontal scroll (deltaX) = trackpad two-finger horizontal swipe
    // Vertical scroll (deltaY) = mouse wheel or trackpad vertical swipe (carousel-style pan)
    const hasScroll = e.deltaX !== 0 || e.deltaY !== 0;
    if (!hasScroll) return;

    e.preventDefault();

    const { x, y, zoom } = getViewport();
    const panDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    const nextX = clampViewportX(x - panDelta);
    setViewport({ x: nextX, y, zoom }, { duration: 0 });
  };
}
