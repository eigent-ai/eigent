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
import { useTranslation } from 'react-i18next';
import { HOME_BOARD_COLUMNS, type HomeBoardColumn } from '../utils/boardStatus';

const COLUMN_LABEL_KEYS: Record<HomeBoardColumn, string> = {
  default: 'layout.home-board-column-default',
  running: 'layout.home-board-column-running',
  awaiting_review: 'layout.home-board-column-awaiting-review',
};

const COLUMN_STYLES: Record<
  HomeBoardColumn,
  { pill: string; count: string; column: string }
> = {
  default: {
    pill: 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default',
    count: 'text-ds-text-neutral-muted-default',
    column: 'bg-ds-bg-neutral-subtle-default/40',
  },
  running: {
    pill: 'bg-ds-bg-status-running-subtle-default text-ds-text-status-running-strong-default',
    count: 'text-ds-text-status-running-strong-default',
    column: 'bg-ds-bg-status-running-subtle-default/20',
  },
  awaiting_review: {
    pill: 'bg-ds-bg-status-blocked-subtle-default text-ds-text-status-blocked-strong-default',
    count: 'text-ds-text-status-blocked-strong-default',
    column: 'bg-ds-bg-status-blocked-subtle-default/20',
  },
};

type HomeHubBoardProps = {
  columns: Record<HomeBoardColumn, ReactNode[]>;
  className?: string;
};

export default function HomeHubBoard({
  columns,
  className,
}: HomeHubBoardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'gap-2 lg:grid-cols-3 grid min-h-[420px] grid-cols-1',
        className
      )}
    >
      {HOME_BOARD_COLUMNS.map((columnId) => {
        const items = columns[columnId];
        const styles = COLUMN_STYLES[columnId];

        return (
          <section
            key={columnId}
            className={cn(
              'min-w-0 rounded-2xl px-3 pb-3 !bg-ds-bg-neutral-default-default flex min-h-[320px] flex-col',
              styles.column
            )}
          >
            <header
              className={cn(
                '-mx-3 mb-3 gap-2 px-3 pb-3 pt-3 rounded-t-2xl sticky z-[9] flex items-center',
                'top-[calc(var(--home-hub-history-tabs-offset,49px)+var(--home-hub-toolbar-sticky-height,5.25rem))]',
                '!bg-ds-bg-neutral-default-default',
                styles.column
              )}
            >
              <span
                className={cn(
                  'px-2.5 py-1 !text-body-sm !font-semibold rounded-full',
                  styles.pill
                )}
              >
                {t(COLUMN_LABEL_KEYS[columnId])}
              </span>
              <span
                className={cn(
                  '!text-label-sm !font-medium text-ds-text-neutral-muted-default tabular-nums',
                  styles.count
                )}
              >
                {items.length}
              </span>
            </header>

            <div className="gap-3 flex w-full flex-col">
              {items.length > 0 ? (
                items
              ) : (
                <div className="rounded-2xl border-ds-border-neutral-muted-default px-3 py-8 !text-label-sm text-ds-text-neutral-muted-default border border-dashed text-center">
                  {t('layout.home-board-column-empty')}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
