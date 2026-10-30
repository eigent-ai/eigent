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
    pill: 'bg-ds-neutral-subtle-default text-ds-ink-muted-default',
    count: 'text-ds-ink-muted-default',
    column: 'bg-ds-neutral-subtle-default/40',
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
        'grid min-h-[420px] grid-cols-1 gap-2 lg:grid-cols-3',
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
              'flex min-h-[320px] min-w-0 flex-col rounded-2xl !bg-ds-neutral-default-default px-3 pb-3',
              styles.column
            )}
          >
            <header
              className={cn(
                'sticky top-0 z-[9] -mx-3 mb-3 flex items-center gap-2 rounded-t-2xl px-3 pt-3 pb-3',
                '!bg-ds-neutral-default-default',
                styles.column
              )}
            >
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 !text-ds-text-base !font-semibold',
                  styles.pill
                )}
              >
                {t(COLUMN_LABEL_KEYS[columnId])}
              </span>
              <span
                className={cn(
                  '!text-ds-text-base !font-medium text-ds-ink-muted-default tabular-nums',
                  styles.count
                )}
              >
                {items.length}
              </span>
            </header>

            <div className="flex w-full flex-col gap-3">
              {items.length > 0 ? (
                items
              ) : (
                <div className="rounded-2xl border border-x border-y border-dashed border-ds-hairline-muted-default px-3 py-8 text-center !text-ds-text-base text-ds-ink-muted-default">
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
