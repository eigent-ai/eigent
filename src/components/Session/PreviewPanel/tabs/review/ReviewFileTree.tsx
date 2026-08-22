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
} from '@/components/Folder';
import { Input } from '@/components/ui/input';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFile } from './useReviewChanges';

export interface ReviewFileTreeProps {
  files: ReviewFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function toFileInfo(file: ReviewFile): FileInfo {
  const normalizedPath = file.path.replace(/\\/g, '/');
  const name = normalizedPath.split('/').filter(Boolean).at(-1) ?? file.path;
  const extensionIndex = name.lastIndexOf('.');

  return {
    name,
    // The review id is the leaf identity. Its display hierarchy comes from
    // relativePath, so equally named overlay files still select independently.
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

/**
 * Review rail around the Context tab's shared FileTree. Only the current
 * project's changed files are adapted into the tree; the review variant adds
 * the A/M/D status marker without forking the Context tree's row design.
 */
export function ReviewFileTree({
  files,
  selectedId,
  onSelect,
}: ReviewFileTreeProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set()
  );

  const query = filter.trim().toLowerCase();
  const visibleFiles = useMemo(
    () =>
      query
        ? files.filter((file) => file.path.toLowerCase().includes(query))
        : files,
    [files, query]
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
    <div className="flex h-full min-h-0 w-[248px] shrink-0 flex-col gap-2 border-0 border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default py-3 pl-2">
      <div className="flex items-center gap-2 pr-2">
        <Input
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
          className="shrink-0"
        />
      </div>
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
        {visibleFiles.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ds-ink-muted-default">
            {t('layout.review-no-matches', {
              defaultValue: 'No files match the filter.',
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
          />
        )}
      </div>
    </div>
  );
}
