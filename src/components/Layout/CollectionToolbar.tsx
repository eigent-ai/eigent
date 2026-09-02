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

export const COLLECTION_TOOLBAR_SEARCH_CLASS = 'w-56 max-w-full';

/** The shared in-page collection toolbar used by Spaces and Skills. */
export default function CollectionToolbar({
  title,
  count,
  headingLevel = 2,
  headingRef,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  title: ReactNode;
  count?: ReactNode;
  headingLevel?: 1 | 2;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section
      className={cn(
        'sticky -top-px z-20 flex min-w-0 flex-wrap items-center justify-between gap-ds-16 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default py-ds-16',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-ds-8">
        <Heading
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="m-0 !text-ds-text-section font-bold text-ds-ink-default-default outline-none"
        >
          {title}
        </Heading>
        {count}
      </div>
      <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-ds-8">
        {children}
      </div>
    </section>
  );
}
