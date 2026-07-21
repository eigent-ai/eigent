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

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChevronRight, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFile } from './useReviewChanges';

interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  kind: 'file';
  name: string;
  file: ReviewFile;
}

type TreeNode = DirNode | FileNode;

const STATUS_DOT: Record<ReviewFile['status'], string> = {
  added: 'bg-ds-bg-success-default-default',
  modified: 'bg-ds-bg-warning-default-default',
  deleted: 'bg-ds-bg-caution-default-default',
};

function buildTree(files: ReviewFile[]): TreeNode[] {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = segments.slice(0, i + 1).join('/');
      let child = node.children.find(
        (candidate): candidate is DirNode =>
          candidate.kind === 'dir' && candidate.path === dirPath
      );
      if (!child) {
        child = { kind: 'dir', name: segments[i], path: dirPath, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      kind: 'file',
      name: segments[segments.length - 1],
      file,
    });
  }
  const sortChildren = (node: DirNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children)
      if (child.kind === 'dir') sortChildren(child);
  };
  sortChildren(root);
  return root.children;
}

export interface ReviewFileTreeProps {
  files: ReviewFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/**
 * Right rail of the review tab: filter box on top, changed files below as a
 * directory tree with per-file status dots. Selecting a file scrolls the diff
 * stack to its card.
 */
export function ReviewFileTree({
  files,
  selectedPath,
  onSelect,
}: ReviewFileTreeProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
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
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  const toggleDir = (path: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === 'dir') {
      // Filtering shows every match regardless of collapse state.
      const isCollapsed = !query && collapsedDirs.has(node.path);
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            onClick={() => toggleDir(node.path)}
            aria-expanded={!isCollapsed}
            style={{ paddingLeft: 8 + depth * 12 }}
            className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent pr-2 text-left hover:bg-ds-bg-neutral-default-hover"
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default transition-transform duration-300',
                !isCollapsed && 'rotate-90'
              )}
              aria-hidden
            />
            <span className="truncate text-xs font-medium text-ds-text-neutral-muted-default">
              {node.name}
            </span>
          </button>
          {!isCollapsed &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const selected = node.file.path === selectedPath;
    return (
      <button
        key={`file:${node.file.path}`}
        type="button"
        onClick={() => onSelect(node.file.path)}
        aria-current={selected || undefined}
        style={{ paddingLeft: 8 + depth * 12 + 18 }}
        className={cn(
          'flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md border-0 pr-2 text-left',
          selected
            ? 'bg-ds-bg-neutral-default-active'
            : 'bg-transparent hover:bg-ds-bg-neutral-default-hover'
        )}
      >
        <FileText
          className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
          aria-hidden
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            node.file.status === 'deleted'
              ? 'text-ds-text-neutral-muted-default line-through'
              : 'text-ds-text-neutral-default-default'
          )}
        >
          {node.name}
        </span>
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            STATUS_DOT[node.file.status]
          )}
          aria-label={node.file.status}
        />
      </button>
    );
  };

  return (
    // No right padding on the rail: the tree's always-visible 8px scrollbar
    // fills that side, and the 8px left padding mirrors it.
    <div className="flex h-full min-h-0 w-[248px] shrink-0 flex-col gap-2 border-0 border-l border-solid border-ds-border-neutral-subtle-default py-2 pl-2">
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
          <p className="px-2 py-3 text-xs text-ds-text-neutral-muted-default">
            {t('layout.review-no-matches', {
              defaultValue: 'No files match the filter.',
            })}
          </p>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
