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

import SearchInput from '@/components/Dashboard/SearchInput';
import {
  buildFileTree,
  FileTree,
  type FileInfo,
  type FileTreeNode,
  type FileTreeStatus,
} from '@/components/Folder';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListFilter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFile } from './useReviewChanges';

export interface ReviewFileTreeProps {
  files: ReviewFile[];
  selectedId: string | null;
  reviewedIds?: ReadonlySet<string>;
  commentCounts?: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
}

function toFileInfo(file: ReviewFile): FileInfo {
  const normalizedPath = file.path.replace(/\\/g, '/');
  const name = normalizedPath.split('/').filter(Boolean).at(-1) ?? file.path;
  const extensionIndex = name.lastIndexOf('.');
  return {
    name,
    path: file.id,
    relativePath: normalizedPath,
    type: extensionIndex >= 0 ? name.slice(extensionIndex + 1) : '',
    status: file.status,
  };
}

function collectFolderPaths(node: FileTreeNode): string[] {
  const paths: string[] = [];
  for (const child of node.children ?? []) {
    if (!child.isFolder) continue;
    paths.push(child.path, ...collectFolderPaths(child));
  }
  return paths;
}

export function ReviewFileTree({
  files,
  selectedId,
  reviewedIds = new Set(),
  commentCounts = new Map(),
  onSelect,
}: ReviewFileTreeProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<FileTreeStatus[]>([]);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set()
  );

  const query = filter.trim().toLowerCase();
  const visibleFiles = useMemo(
    () =>
      files.filter((file) => {
        if (query && !file.path.toLowerCase().includes(query)) return false;
        if (statusFilter.length > 0 && !statusFilter.includes(file.status)) {
          return false;
        }
        return !unreviewedOnly || !reviewedIds.has(file.id);
      }),
    [files, query, reviewedIds, statusFilter, unreviewedOnly]
  );
  const fileInfos = useMemo(() => visibleFiles.map(toFileInfo), [visibleFiles]);
  const tree = useMemo(() => buildFileTree(fileInfos), [fileInfos]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const expandedFolders = useMemo(
    () =>
      new Set(
        query
          ? folderPaths
          : folderPaths.filter((path) => !collapsedFolders.has(path))
      ),
    [collapsedFolders, folderPaths, query]
  );
  const selectedFile = useMemo(
    () => (selectedId ? files.find((file) => file.id === selectedId) : null),
    [files, selectedId]
  );

  const toggleFolder = (path: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleStatusFilter = (status: FileTreeStatus, checked: boolean) => {
    setStatusFilter((current) =>
      checked
        ? current.includes(status)
          ? current
          : [...current, status]
        : current.filter((value) => value !== status)
    );
  };

  const statusOptions: Array<{
    value: FileTreeStatus;
    label: string;
    className: string;
  }> = [
    {
      value: 'added',
      label: t('layout.review-filter-added-files', {
        defaultValue: 'Added files',
      }),
      className: '!text-ds-text-success-default-default',
    },
    {
      value: 'modified',
      label: t('layout.review-filter-modified-files', {
        defaultValue: 'Modified files',
      }),
      className: '!text-ds-text-warning-default-default',
    },
    {
      value: 'deleted',
      label: t('layout.review-filter-deleted-files', {
        defaultValue: 'Deleted files',
      }),
      className: '!text-ds-text-error-default-default',
    },
  ];

  const hasActiveFilters = statusFilter.length > 0 || unreviewedOnly;

  return (
    <aside className="flex h-full min-h-0 w-[264px] shrink-0 flex-col border-0 border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
      <div
        data-testid="review-file-tree-header"
        className="flex h-10 shrink-0 items-center gap-2 border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-2"
      >
        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('layout.review-filter-files', {
            defaultValue: 'Filter files…',
          })}
          ariaLabel={t('layout.review-filter-files', {
            defaultValue: 'Filter files…',
          })}
          clearOnEscape
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={hasActiveFilters ? 'secondary' : 'ghost'}
              size="sm"
              buttonContent="icon-only"
              className="data-[state=open]:!bg-ds-neutral-muted-default"
              aria-label={t('layout.review-filter-status', {
                defaultValue: 'Filter by change status',
              })}
              aria-pressed={hasActiveFilters}
            >
              <ListFilter aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {statusOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                className={option.className}
                checked={statusFilter.includes(option.value)}
                onCheckedChange={(checked) =>
                  toggleStatusFilter(option.value, checked === true)
                }
                onSelect={(event) => event.preventDefault()}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuCheckboxItem
              className="!text-ds-ink-default-default"
              checked={unreviewedOnly}
              onCheckedChange={(checked) => setUnreviewedOnly(checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t('layout.review-unreviewed', { defaultValue: 'Unreviewed' })}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto p-2">
        {visibleFiles.length === 0 ? (
          <p className="px-2 py-3 text-ds-text-meta text-ds-ink-muted-default">
            {t('layout.review-no-matches', {
              defaultValue: 'No files match the current filters.',
            })}
          </p>
        ) : (
          <FileTree
            node={tree}
            selectedFile={selectedFile ? toFileInfo(selectedFile) : null}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onSelectFile={(file) => onSelect(file.path)}
            isShowSourceCode={false}
            variant="review"
            reviewedFileIds={reviewedIds}
            reviewCommentCounts={commentCounts}
          />
        )}
      </div>
      <div className="shrink-0 border-0 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-3 py-2 text-ds-text-meta text-ds-ink-muted-default">
        {t('layout.review-visible-files', {
          defaultValue: '{{visible}} of {{total}} files',
          visible: visibleFiles.length,
          total: files.length,
        })}
      </div>
    </aside>
  );
}
