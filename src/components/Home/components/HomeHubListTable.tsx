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
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeHubItemKind } from './HomeHubItemShared';
import {
  HOME_HUB_LIST_GRID_CLASS,
  HomeHubListLayoutContext,
} from './HomeHubItemShared';

type HomeHubListColumn = {
  id: string;
  labelKey?: string;
  align?: 'left' | 'right';
};

const LIST_COLUMNS: Record<HomeHubItemKind, HomeHubListColumn[]> = {
  space: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'type', labelKey: 'layout.home-list-type' },
    { id: 'projects', labelKey: 'layout.projects', align: 'right' },
    { id: 'tasks', labelKey: 'layout.tasks-heading', align: 'right' },
    { id: 'triggers', labelKey: 'layout.triggers', align: 'right' },
    { id: 'created', labelKey: 'layout.home-list-created', align: 'right' },
    { id: 'action', align: 'right' },
  ],
  project: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'space', labelKey: 'layout.home-list-space' },
    { id: 'tasks', labelKey: 'layout.tasks-heading', align: 'right' },
    { id: 'triggers', labelKey: 'layout.triggers', align: 'right' },
    { id: 'updated', labelKey: 'layout.home-list-updated', align: 'right' },
  ],
  task: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'space', labelKey: 'layout.home-list-space' },
    { id: 'created', labelKey: 'layout.home-list-created', align: 'right' },
  ],
  trigger: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'space', labelKey: 'layout.home-list-space' },
    { id: 'type', labelKey: 'layout.home-list-type' },
    { id: 'status', labelKey: 'layout.home-list-status' },
    { id: 'created', labelKey: 'layout.home-list-created', align: 'right' },
  ],
};

const LIST_MIN_WIDTH_CLASS: Record<HomeHubItemKind, string> = {
  space: 'min-w-[720px]',
  project: 'min-w-[560px]',
  task: 'min-w-[420px]',
  trigger: 'min-w-[560px]',
};

const PROJECT_WITHOUT_SPACE_GRID_CLASS =
  'grid-cols-[minmax(0,2fr)_72px_72px_80px]';

type HomeHubListTableProps = {
  kind: HomeHubItemKind;
  children: ReactNode;
  className?: string;
  hideSpaceColumn?: boolean;
};

export default function HomeHubListTable({
  kind,
  children,
  className,
  hideSpaceColumn = false,
}: HomeHubListTableProps) {
  const { t } = useTranslation();
  const hiddenColumns = hideSpaceColumn ? ['space'] : [];
  const columns = LIST_COLUMNS[kind].filter(
    (column) => !hiddenColumns.includes(column.id)
  );
  const gridClass =
    kind === 'project' && hideSpaceColumn
      ? PROJECT_WITHOUT_SPACE_GRID_CLASS
      : HOME_HUB_LIST_GRID_CLASS[kind];
  const label = {
    space: t('layout.spaces'),
    project: t('layout.projects'),
    task: t('layout.tasks-heading'),
    trigger: t('layout.triggers'),
  }[kind];

  return (
    <div
      role="table"
      aria-label={label}
      className={cn('w-full min-w-0 overflow-x-auto', className)}
    >
      <HomeHubListLayoutContext.Provider value={{ gridClass, hiddenColumns }}>
        <div className={LIST_MIN_WIDTH_CLASS[kind]}>
          <div role="rowgroup">
            <div
              role="row"
              className={cn('grid items-center gap-x-4 px-3 py-2.5', gridClass)}
            >
              {columns.map((column) => (
                <span
                  key={column.id}
                  role="columnheader"
                  data-home-hub-column={column.id}
                  className={cn(
                    'truncate !text-ds-text-base leading-none font-normal text-ds-ink-muted-default',
                    column.align === 'right' ? 'text-right' : 'text-left'
                  )}
                >
                  {column.labelKey ? (
                    t(column.labelKey)
                  ) : (
                    <span className="sr-only">
                      {t('layout.workspace-action', {
                        defaultValue: 'Workspace action',
                      })}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
          <div role="rowgroup" className="flex flex-col gap-1">
            {children}
          </div>
        </div>
      </HomeHubListLayoutContext.Provider>
    </div>
  );
}
