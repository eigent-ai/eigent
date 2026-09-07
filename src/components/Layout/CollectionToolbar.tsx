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
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import ContentHeader, { CONTENT_HEADER_TITLE_CLASS } from './ContentHeader';

export const COLLECTION_TOOLBAR_SEARCH_CLASS = 'w-56 max-w-full';

export const COLLECTION_RAIL_CLASS = {
  standard: 'max-w-[964px]',
  wide: 'max-w-[1100px]',
} as const;

/**
 * Page-level header for searchable collections. The outer header owns the
 * full-width divider while the inner rail stays aligned with the collection
 * content below it.
 */
export default function CollectionToolbar({
  title,
  count,
  headingLevel = 2,
  headingRef,
  width = 'standard',
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  title: ReactNode;
  count?: ReactNode;
  headingLevel?: 1 | 2;
  headingRef?: Ref<HTMLHeadingElement>;
  width?: keyof typeof COLLECTION_RAIL_CLASS;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <ContentHeader height="adaptive" inset="none">
      <section
        role="region"
        className={cn(
          'mx-auto flex min-h-ds-layout-row-header w-full min-w-0 flex-wrap items-center justify-between gap-x-ds-16 gap-y-ds-8 px-ds-32 py-ds-6',
          COLLECTION_RAIL_CLASS[width],
          className
        )}
        {...props}
      >
        <div className="flex min-w-0 shrink-0 items-center gap-ds-8">
          <Heading
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className={cn('m-0 outline-none', CONTENT_HEADER_TITLE_CLASS)}
          >
            {title}
          </Heading>
          {count}
        </div>
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-ds-8">
          {children}
        </div>
      </section>
    </ContentHeader>
  );
}
