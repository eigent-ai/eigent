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

import { cn } from '@/lib/utils';
import { useIsPresent } from 'framer-motion';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Canonical layout header row: 40px, 8px inline inset, overflow visible so
 * the 2px focus ring is not clipped. Composes Button `sm` (28px).
 */
const CONTENT_HEADER_BASE_CLASS =
  'flex w-full shrink-0 items-center gap-ds-6 overflow-visible';

export const CONTENT_HEADER_CLASS = `${CONTENT_HEADER_BASE_CLASS} h-ds-layout-row-header min-h-ds-layout-row-header px-ds-8`;

/** Bottom hairline for headers that sit above a scrolling list. */
export const CONTENT_HEADER_BORDER_CLASS =
  'border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default';

/** Title typography, exported for `titleAsChild` callers to reapply. */
export const CONTENT_HEADER_TITLE_CLASS =
  'min-w-0 shrink truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default';

const ContentHeaderFrameContext = createContext<{
  activeKey: string;
  element: HTMLElement | null;
} | null>(null);
const ContentHeaderOwnerContext = createContext<string | null>(null);

export const ContentHeaderOwner = ContentHeaderOwnerContext.Provider;

/** Capture this value on a keyed animation child, including its lazy content. */
export function useContentHeaderOwner() {
  return useContext(ContentHeaderOwnerContext);
}

/** Keep the page divider outside keyed content transitions and lazy loading. */
export function ContentHeaderFrame({
  activeKey,
  enabled = true,
  children,
}: {
  activeKey: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ activeKey, element }), [activeKey, element]);
  return (
    <ContentHeaderFrameContext.Provider value={enabled ? value : null}>
      {enabled && (
        <header
          ref={setElement}
          data-content-header-frame
          className="relative min-h-ds-layout-row-header w-full shrink-0"
        >
          <div
            aria-hidden
            data-content-header-divider
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0',
              CONTENT_HEADER_BORDER_CLASS
            )}
          />
        </header>
      )}
      {children}
    </ContentHeaderFrameContext.Provider>
  );
}

/**
 * Controls placed in a `ContentHeader` share one size so their heights match
 * the 40px row: `size="sm"` (28px) with `buttonContent="icon-only"` for icon
 * buttons and `buttonContent="text"` for labelled ones.
 */
export interface ContentHeaderProps {
  /** Leading control before the title (e.g. back/toggle button). */
  leading?: ReactNode;
  /** Header title; omit for headers that only carry controls. */
  title?: ReactNode;
  /**
   * Render `title` as-is instead of wrapping it in the default `<span>`. Use
   * when the title must be a real heading element — a heading nested in the
   * wrapper span would be invalid content nesting. Apply
   * {@link CONTENT_HEADER_TITLE_CLASS} to the element you pass.
   */
  titleAsChild?: boolean;
  /** Right-aligned controls — keep every button at `size="sm"`. */
  actions?: ReactNode;
  /** Free-form children rendered after the title, before `actions`. */
  children?: ReactNode;
  /** Bottom divider (default true). */
  border?: boolean;
  /** Allow a named composition such as a collection toolbar to wrap safely. */
  height?: 'routine' | 'adaptive';
  /** Remove the outer inset when a child pattern owns its aligned content rail. */
  inset?: 'default' | 'none';
  className?: string;
  /** Render in the nearest stable page frame, outside content animations. */
  persistent?: boolean;
}

export default function ContentHeader({
  leading,
  title,
  titleAsChild = false,
  actions,
  children,
  border = true,
  height = 'routine',
  inset = 'default',
  className,
  persistent = false,
}: ContentHeaderProps) {
  const frame = useContext(ContentHeaderFrameContext);
  const ownerKey = useContentHeaderOwner();
  const isPresent = useIsPresent();
  const portaled = persistent && frame !== null;
  const Element = portaled ? 'div' : 'header';
  const content = (
    <Element
      className={cn(
        CONTENT_HEADER_BASE_CLASS,
        height === 'routine'
          ? 'h-ds-layout-row-header min-h-ds-layout-row-header'
          : 'min-h-ds-layout-row-header',
        inset === 'default' && 'px-ds-8',
        border && !portaled && CONTENT_HEADER_BORDER_CLASS,
        className
      )}
    >
      {leading}
      {title ? (
        titleAsChild ? (
          title
        ) : (
          <span className={CONTENT_HEADER_TITLE_CLASS}>{title}</span>
        )
      ) : null}
      {children}
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-ds-8">
          {actions}
        </div>
      ) : null}
    </Element>
  );
  if (!portaled) return content;
  return frame.element && ownerKey === frame.activeKey && isPresent
    ? createPortal(content, frame.element)
    : null;
}
