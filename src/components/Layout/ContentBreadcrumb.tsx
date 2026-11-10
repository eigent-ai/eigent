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

import { DsIcon } from '@/components/ui/ds-icon';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import type { Ref } from 'react';

export interface ContentBreadcrumbSegment {
  /** Visible label. */
  label: string;
  /** Navigates when set; the trailing (current) segment is never clickable. */
  onClick?: () => void;
}

interface ContentBreadcrumbProps {
  /** Ancestors first, current page last. */
  segments: ContentBreadcrumbSegment[];
  /** Accessible name for the navigation landmark. */
  ariaLabel: string;
  /**
   * Ref on the trailing segment when `currentAsHeading` is true, so the 40px
   * header row can carry and focus the document heading.
   */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * Keep the current segment as compact breadcrumb text when the page owns a
   * separate visible h1 below the canonical header row.
   */
  currentAsHeading?: boolean;
  className?: string;
}

/**
 * Breadcrumb trail for the canonical 40px `ContentHeader` row. Ancestors stay
 * muted and collapse first. The compact base-text treatment matches the
 * adjacent sidebar back row. The trailing segment is the page h1 by default.
 */
export default function ContentBreadcrumb({
  segments,
  ariaLabel,
  headingRef,
  currentAsHeading = true,
  className,
}: ContentBreadcrumbProps) {
  const lastIndex = segments.length - 1;
  const currentSegment = segments[lastIndex];
  const trailSegments = currentAsHeading ? segments.slice(0, -1) : segments;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-ds-4 overflow-hidden',
        className
      )}
    >
      {trailSegments.length > 0 ? (
        <nav
          aria-label={ariaLabel}
          className={cn('min-w-0', currentAsHeading ? 'shrink-0' : 'flex-1')}
        >
          <ol className="m-0 flex min-w-0 list-none items-center gap-ds-4 p-0">
            {trailSegments.map((segment, index) => {
              const isCurrent = !currentAsHeading && index === lastIndex;
              const isClickable = !isCurrent && Boolean(segment.onClick);

              return (
                <li
                  key={`${index}-${segment.label}`}
                  className={cn(
                    'flex min-w-0 items-center gap-ds-4',
                    isCurrent ? 'shrink' : 'shrink-0'
                  )}
                >
                  {index > 0 ? (
                    <DsIcon
                      icon={ChevronRight}
                      recipe="main-compact"
                      className="shrink-0 text-ds-ink-muted-default"
                    />
                  ) : null}
                  {isCurrent ? (
                    <span
                      title={segment.label}
                      aria-current="page"
                      className="min-w-0 shrink truncate !text-ds-text-base font-semibold text-ds-ink-default-default"
                    >
                      {segment.label}
                    </span>
                  ) : isClickable ? (
                    <button
                      type="button"
                      onClick={segment.onClick}
                      title={segment.label}
                      className={cn(
                        'shrink-0 cursor-pointer rounded-ds-4 border-0 border-x-0 border-y-0 bg-transparent p-0 whitespace-nowrap',
                        '!text-ds-text-base font-normal text-ds-ink-muted-default',
                        'transition-colors duration-150 hover:text-ds-ink-default-default hover:underline motion-reduce:transition-none',
                        DS_FOCUS_RING
                      )}
                    >
                      {segment.label}
                    </button>
                  ) : (
                    <span
                      title={segment.label}
                      className="shrink-0 !text-ds-text-base font-normal whitespace-nowrap text-ds-ink-muted-default"
                    >
                      {segment.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      {currentAsHeading && currentSegment ? (
        <>
          {trailSegments.length > 0 ? (
            <DsIcon
              icon={ChevronRight}
              recipe="main-compact"
              className="shrink-0 text-ds-ink-muted-default"
            />
          ) : null}
          <h1
            ref={headingRef}
            tabIndex={-1}
            title={currentSegment.label}
            className="m-0 min-w-0 shrink truncate !text-ds-text-base font-semibold text-ds-ink-default-default outline-none"
          >
            {currentSegment.label}
          </h1>
        </>
      ) : null}
    </div>
  );
}
