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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  CHAT_MIN_WIDTH,
  clampChatSideWidth,
  getMaxChatSideWidth,
  RESIZE_KEYBOARD_STEP,
  SUMMARY_DOCK_MIN_WIDTH,
} from './sessionColumns';

/** Live chat side width, written directly while dragging. */
export const CHAT_SIDE_WIDTH_VAR = '--session-chat-side-width';
const RESIZE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

interface UsePreviewResizeOptions {
  /** Session row that carries the live width variable. */
  rowRef: RefObject<HTMLDivElement | null>;
  visibleChatSideWidth: number;
  maxChatSideWidth: number;
  /** Commit a chat side width to React state. */
  setChatSideWidth: (width: number) => void;
  /** Any change cancels an active drag (column visibility, pane width, scope). */
  resetKey: string;
}

/**
 * Pointer and keyboard resizing for the divider between the chat side and
 * Preview. Pointer frames write the width variable and aria value directly;
 * React only commits at Summary dock threshold crossings and on release.
 */
export function usePreviewResize({
  rowRef,
  visibleChatSideWidth,
  maxChatSideWidth,
  setChatSideWidth,
  resetKey,
}: UsePreviewResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const liveWidthRef = useRef(CHAT_MIN_WIDTH);
  const cleanupRef = useRef<((commitWidth?: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    cleanupRef.current?.();
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!isResizing) {
      liveWidthRef.current = visibleChatSideWidth;
      rowRef.current?.style.setProperty(
        CHAT_SIDE_WIDTH_VAR,
        `${visibleChatSideWidth}px`
      );
    }
  }, [rowRef, visibleChatSideWidth, isResizing]);

  // A drag can outlive the Session when the user switches Project or route.
  // Remove every native listener without scheduling state on an unmounted tree.
  useEffect(
    () => () => {
      cleanupRef.current?.(false);
    },
    []
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      cleanupRef.current?.();
      const maxWidth = getMaxChatSideWidth(
        rowRef.current?.getBoundingClientRect().width ?? window.innerWidth
      );
      const startX = e.clientX;
      const startWidth = visibleChatSideWidth;
      const pointerId = e.pointerId;
      const handle = e.currentTarget;
      const body = document.body;
      const previousCursor = body.style.cursor;
      const previousUserSelect = body.style.userSelect;
      let pendingWidth = startWidth;
      let frameId: number | null = null;
      let finished = false;
      let canDockAtLastCommit = startWidth >= SUMMARY_DOCK_MIN_WIDTH;

      setIsResizing(true);
      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';

      const applyPendingWidth = () => {
        frameId = null;
        rowRef.current?.style.setProperty(
          CHAT_SIDE_WIDTH_VAR,
          `${pendingWidth}px`
        );
        liveWidthRef.current = pendingWidth;
        handle.setAttribute('aria-valuenow', String(pendingWidth));
        const canDock = pendingWidth >= SUMMARY_DOCK_MIN_WIDTH;
        if (canDock !== canDockAtLastCommit) {
          canDockAtLastCommit = canDock;
          setChatSideWidth(pendingWidth);
        }
      };

      const finishResize = (commitWidth = true) => {
        if (finished) return;
        finished = true;
        cleanupRef.current = null;
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          if (commitWidth) applyPendingWidth();
        }

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
        window.removeEventListener('blur', onWindowBlur);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        handle.removeEventListener('lostpointercapture', onLostPointerCapture);
        try {
          if (handle.hasPointerCapture?.(pointerId)) {
            handle.releasePointerCapture(pointerId);
          }
        } catch {
          // The browser may already have released capture during cancellation.
        }

        if (body.style.cursor === 'col-resize') {
          body.style.cursor = previousCursor;
        }
        if (body.style.userSelect === 'none') {
          body.style.userSelect = previousUserSelect;
        }
        if (commitWidth) {
          setChatSideWidth(pendingWidth);
          setIsResizing(false);
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        // Cross-origin iframes and Electron webviews can consume pointerup.
        // A later move with no pressed button is an equivalent end signal.
        if (ev.buttons === 0) {
          finishResize();
          return;
        }
        ev.preventDefault();
        // Dragging right (larger clientX) widens the chat, shrinking the preview.
        pendingWidth = clampChatSideWidth(
          startWidth + (ev.clientX - startX),
          maxWidth
        );
        if (frameId === null) {
          frameId = window.requestAnimationFrame(applyPendingWidth);
        }
      };
      const onPointerEnd = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) finishResize();
      };
      const onWindowBlur = () => finishResize();
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') finishResize();
      };
      const onLostPointerCapture = () => finishResize();

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
      window.addEventListener('blur', onWindowBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);
      handle.addEventListener('lostpointercapture', onLostPointerCapture);
      cleanupRef.current = finishResize;
      try {
        handle.setPointerCapture?.(pointerId);
      } catch {
        // The fixed drag shield remains the fallback for older hosts.
      }
    },
    [rowRef, visibleChatSideWidth, setChatSideWidth]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!RESIZE_KEYS.has(event.key)) return;
      event.preventDefault();
      // Flush an active drag first so the step starts from its latest width.
      cleanupRef.current?.();
      let nextWidth = liveWidthRef.current;
      if (event.key === 'ArrowLeft') nextWidth -= RESIZE_KEYBOARD_STEP;
      else if (event.key === 'ArrowRight') nextWidth += RESIZE_KEYBOARD_STEP;
      else if (event.key === 'Home') nextWidth = CHAT_MIN_WIDTH;
      else nextWidth = maxChatSideWidth;
      setChatSideWidth(clampChatSideWidth(nextWidth, maxChatSideWidth));
    },
    [maxChatSideWidth, setChatSideWidth]
  );

  return { isResizing, onPointerDown, onKeyDown };
}
