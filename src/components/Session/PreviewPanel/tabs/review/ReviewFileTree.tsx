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

import {
  buildFileTree,
  FileTree,
  type FileInfo,
  type FileTreeNode,
  type FileTreeStatus,
} from '@/components/Folder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CheckCircle2 } from 'lucide-react';
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

  return (
    <aside className="flex h-full min-h-0 w-[264px] shrink-0 flex-col border-0 border-y-0 border-r border-l-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
      <div className="flex flex-col gap-2 border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default p-2.5">
        <Input
          size="sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFilter('');
          }}
          placeholder={t('layout.review-filter-files', {
            defaultValue: 'Filter files…',
          })}
          aria-label={t('layout.review-filter-files', {
            defaultValue: 'Filter files…',
          })}
        />
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup
            type="multiple"
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as FileTreeStatus[])
            }
            size="sm"
            aria-label={t('layout.review-filter-status', {
              defaultValue: 'Filter by change status',
            })}
          >
            {(['added', 'modified', 'deleted'] as const).map((status) => (
              <ToggleGroupItem
                key={status}
                value={status}
                className="font-code font-semibold"
                aria-label={status}
              >
                {status[0].toUpperCase()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            type="button"
            variant={unreviewedOnly ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setUnreviewedOnly((value) => !value)}
            aria-pressed={unreviewedOnly}
          >
            <CheckCircle2 aria-hidden />
            {t('layout.review-unreviewed', { defaultValue: 'Unreviewed' })}
          </Button>
        </div>
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
