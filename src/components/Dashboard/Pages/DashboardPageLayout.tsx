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

export type DashboardPageWidth = 'constrained' | 'full';

const horizontalPadDefault = 'px-0';

/** Shared heading row (page title + optional trailing actions); used inside pages and full layouts. */
export function DashboardPageTitleRow({
  title,
  headerEnd,
  horizontalPadding,
  className,
}: {
  title: ReactNode;
  headerEnd?: ReactNode;
  /** Tailwind gutter (e.g. `px-6`, `px-[70px]`). Defaults to `px-6`. */
  horizontalPadding?: string;
  className?: string;
}) {
  const hPad = horizontalPadding ?? horizontalPadDefault;

  return (
    <div
      className={cn(
        'pb-6 pt-8 flex w-full items-center justify-between',
        hPad,
        className
      )}
    >
      <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
        {title}
      </div>
      {headerEnd}
    </div>
  );
}

type DashboardPageLayoutProps = {
  title: ReactNode;
  /** Horizontal nav strip (same visual language as workspace tabs), placed under the title */
  tabs?: ReactNode;
  children: ReactNode;
  /** `constrained` = max-width column centered in the viewport area; `full` for hub project/task rails */
  width?: DashboardPageWidth;
  /** Title row trailing content (buttons, badges) */
  headerEnd?: ReactNode;
  className?: string;
  /** Gutter for title, tabs, and main column (e.g. `px-6` embedded, `px-[70px]` standalone hub) */
  horizontalPadding?: string;
};

export default function DashboardPageLayout({
  title,
  tabs,
  children,
  width = 'constrained',
  headerEnd,
  className,
  horizontalPadding,
}: DashboardPageLayoutProps) {
  const hPad = horizontalPadding ?? horizontalPadDefault;

  return (
    <div
      className={cn(
        'flex h-auto w-full flex-1 flex-col',
        width === 'constrained' && 'mx-auto w-full max-w-[1020px]',
        className
      )}
    >
      <DashboardPageTitleRow
        title={title}
        headerEnd={headerEnd}
        horizontalPadding={horizontalPadding}
      />
      {tabs != null ? (
        <div className={cn('pb-6 w-full shrink-0', hPad)}>{tabs}</div>
      ) : null}
      <div className={cn('min-h-0 pb-12 flex w-full flex-1 flex-col', hPad)}>
        {children}
      </div>
    </div>
  );
}
