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
import type { ReactNode } from 'react';

/**
 * Canonical layout header row: 40px, 8px inline inset, overflow visible so
 * the 2px focus ring is not clipped. Composes Button `sm` (28px).
 */
export const CONTENT_HEADER_CLASS =
  'flex h-ds-layout-row-header min-h-ds-layout-row-header w-full shrink-0 items-center gap-ds-6 overflow-visible px-ds-8';

/** Bottom hairline for headers that sit above a scrolling list. */
export const CONTENT_HEADER_BORDER_CLASS =
  'border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default';

/** Title typography, exported for `titleAsChild` callers to reapply. */
export const CONTENT_HEADER_TITLE_CLASS =
  'min-w-0 shrink truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default';

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
  className?: string;
}

export default function ContentHeader({
  leading,
  title,
  titleAsChild = false,
  actions,
  children,
  border = true,
  className,
}: ContentHeaderProps) {
  return (
    <header
      className={cn(
        CONTENT_HEADER_CLASS,
        border && CONTENT_HEADER_BORDER_CLASS,
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
    </header>
  );
}
