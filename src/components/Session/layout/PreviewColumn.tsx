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

import { motion } from 'framer-motion';
import {
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CHAT_MIN_WIDTH } from './sessionColumns';

/** How a Session column opens beside the chat; Activity shares it. */
export const PREVIEW_ENTRANCE_TWEEN = {
  type: 'tween' as const,
  duration: 0.2,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};
const NO_TRANSITION = { duration: 0 };
/** The content's way in: from the right, out of a light blur. */
const CONTENT_ENTRANCE_OFFSET_PX = 16;
const CONTENT_ENTRANCE_BLUR = 'blur(6px)';

export interface PreviewResizeHandleProps {
  isResizing: boolean;
  /** Current chat side width; the handle's value. */
  value: number;
  max: number;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

function PreviewResizeHandle({
  isResizing,
  value,
  max,
  onPointerDown,
  onKeyDown,
}: PreviewResizeHandleProps) {
  const { t } = useTranslation();
  return (
    <div
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      role="separator"
      aria-orientation="vertical"
      data-resize-handle-state={isResizing ? 'drag' : 'inactive'}
      tabIndex={0}
      aria-label={t('layout.resize-preview')}
      aria-valuemin={CHAT_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={value}
      // Overlap the border without reserving a separate layout column.
      className="absolute inset-y-0 left-0 z-10 w-ds-8 -translate-x-1/2 cursor-col-resize outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-inset"
    />
  );
}

interface PreviewColumnProps {
  /** Shortcut or keyboard opening: no geometry or opacity motion. */
  immediateOpening: boolean;
  /** Immediate or reduced-motion opening: no geometry motion. */
  immediateGeometry: boolean;
  /**
   * The column's width once open. While it grows, its content is laid out at
   * this width, so it slides in instead of reflowing as the column widens.
   */
  settledWidth?: number | null;
  onEntranceComplete: () => void;
  resizeHandle: PreviewResizeHandleProps;
  children: ReactNode;
}

/**
 * Full-height Preview column to the right of the chat side. It owns the single
 * left border and the divider that resizes the chat side. Key it by open
 * request so each opening replays its entrance.
 *
 * The column grows rightward from the chat side. Its content keeps its open
 * width meanwhile and comes in from the right, fading out of a light blur, so
 * the tabs and their content arrive the way the column opens.
 */
export function PreviewColumn({
  immediateOpening,
  immediateGeometry,
  settledWidth,
  onEntranceComplete,
  resizeHandle,
  children,
}: PreviewColumnProps) {
  const geometryTransition = immediateGeometry
    ? NO_TRANSITION
    : PREVIEW_ENTRANCE_TWEEN;
  // Only a growing column needs the fixed width and the slide.
  const slideContent = !immediateGeometry;
  const [entering, setEntering] = useState(slideContent);
  return (
    <motion.div
      initial={
        immediateOpening
          ? false
          : immediateGeometry
            ? { flexGrow: 1, opacity: 0, transform: 'translateX(0%)' }
            : { flexGrow: 0, opacity: 0, transform: 'translateX(3%)' }
      }
      animate={{ flexGrow: 1, opacity: 1, transform: 'translateX(0%)' }}
      transition={{
        flexGrow: geometryTransition,
        transform: geometryTransition,
        opacity: immediateOpening ? NO_TRANSITION : PREVIEW_ENTRANCE_TWEEN,
      }}
      onAnimationComplete={() => {
        setEntering(false);
        onEntranceComplete();
      }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col border-y-0 border-r-0 border-l-[length:var(--ds-border-thin)] border-solid border-ds-hairline-subtle-disabled"
    >
      <PreviewResizeHandle {...resizeHandle} />
      {/* Preview owns its header beside the chat/Activity group. */}
      <motion.div
        data-preview-column-content
        data-preview-entering={entering ? 'true' : 'false'}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        // Only the width is held: the column stacks vertically, so the
        // content keeps filling its height and centred tabs open centred.
        style={
          entering && settledWidth
            ? { width: `calc(${settledWidth}px - var(--ds-border-thin))` }
            : undefined
        }
        initial={
          slideContent
            ? {
                x: CONTENT_ENTRANCE_OFFSET_PX,
                filter: CONTENT_ENTRANCE_BLUR,
              }
            : false
        }
        // A filter left on an ancestor would trap the fixed-position browser
        // view, so it is removed once the blur has cleared.
        animate={{
          x: 0,
          filter: 'blur(0px)',
          transitionEnd: { filter: 'none' },
        }}
        transition={slideContent ? PREVIEW_ENTRANCE_TWEEN : NO_TRANSITION}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
