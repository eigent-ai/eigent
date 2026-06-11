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
import { HOME_HUB_LIST_GRID_CLASS } from './HomeHubItemShared';

type HomeHubListColumn = {
  id: string;
  labelKey: string;
  align?: 'left' | 'right';
};

const LIST_COLUMNS: Record<HomeHubItemKind, HomeHubListColumn[]> = {
  space: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'type', labelKey: 'layout.home-list-type' },
    { id: 'projects', labelKey: 'layout.projects', align: 'right' },
    { id: 'tasks', labelKey: 'layout.tasks', align: 'right' },
    { id: 'triggers', labelKey: 'layout.triggers', align: 'right' },
    { id: 'created', labelKey: 'layout.home-list-created', align: 'right' },
  ],
  project: [
    { id: 'name', labelKey: 'layout.home-list-name' },
    { id: 'space', labelKey: 'layout.home-list-space' },
    { id: 'tasks', labelKey: 'layout.tasks', align: 'right' },
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

type HomeHubListTableProps = {
  kind: HomeHubItemKind;
  children: ReactNode;
  className?: string;
};

export default function HomeHubListTable({
  kind,
  children,
  className,
}: HomeHubListTableProps) {
  const { t } = useTranslation();
  const columns = LIST_COLUMNS[kind];
  const gridClass = HOME_HUB_LIST_GRID_CLASS[kind];

  return (
    <div className={cn('min-w-0 w-full', className)}>
      <div className={cn('gap-x-4 px-3 py-2.5 grid items-center', gridClass)}>
        {columns.map((column) => (
          <span
            key={column.id}
            className={cn(
              '!text-label-sm font-normal text-ds-text-neutral-muted-default truncate leading-none',
              column.align === 'right' ? 'text-right' : 'text-left'
            )}
          >
            {t(column.labelKey)}
          </span>
        ))}
      </div>
      <div className="gap-1 flex flex-col">{children}</div>
    </div>
  );
}
