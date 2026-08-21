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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useAuthStore } from '@/store/authStore';
import type {
  SessionReviewTab,
  SessionReviewTarget,
} from '@/store/pageTabStore';
import {
  FileDiff,
  FolderClosed,
  FolderOpen,
  ListChevronsDownUp,
  ListChevronsUpDown,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiffFileCard } from './review/DiffFileCard';
import { ReviewFileTree } from './review/ReviewFileTree';
import { useReviewChanges } from './review/useReviewChanges';

/**
 * Read-only change showcase: every file the agents changed in this project,
 * shown as before-vs-after diffs. Left is a stacked file-by-file diff view;
 * right is the changed-file tree. This is not an approval surface — undoing
 * changes is a separate (future) rewind feature.
 */
const DEFAULT_REVIEW_TARGET: SessionReviewTarget = {
  scope: 'project',
  focusRequestId: 0,
};

function normalizedReviewPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function ReviewTab({ tab }: { tab: SessionReviewTab }) {
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const reviewTarget = tab.reviewTarget ?? DEFAULT_REVIEW_TARGET;
  const { loading, files, desktopOnly, error, totals, truncated, refresh } =
    useReviewChanges(reviewTarget);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Collapsing the rail gives the diffs the full panel width, which matters on
  // a narrow preview panel. Resets per mount — this is a per-look preference,
  // not a setting worth persisting.
  const [treeHidden, setTreeHidden] = useState(false);
  // Cards own their fold state so individual ones stay togglable; the nonce is
  // what tells them a toolbar command was issued rather than a re-render.
  const [foldAll, setFoldAll] = useState(false);
  const [foldNonce, setFoldNonce] = useState(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const toggleFoldAll = useCallback(() => {
    setFoldAll((folded) => !folded);
    setFoldNonce((nonce) => nonce + 1);
  }, []);

  const foldToggleLabel = foldAll
    ? t('layout.review-expand-all', { defaultValue: 'Expand all files' })
    : t('layout.review-collapse-all', { defaultValue: 'Collapse all files' });

  const treeToggleLabel = treeHidden
    ? t('layout.review-show-tree', { defaultValue: 'Show file tree' })
    : t('layout.review-hide-tree', { defaultValue: 'Hide file tree' });

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    const card = stackRef.current?.querySelector(
      `[data-review-id=${CSS.escape(id)}]`
    );
    card?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const focusPath = reviewTarget.focusPath
      ? normalizedReviewPath(reviewTarget.focusPath)
      : null;
    if (!focusPath) return;
    const file = files.find(
      (candidate) => normalizedReviewPath(candidate.path) === focusPath
    );
    if (file) handleSelect(file.id);
  }, [
    files,
    handleSelect,
    reviewTarget.focusPath,
    reviewTarget.focusRequestId,
  ]);

  const runScoped = reviewTarget.scope === 'run';

  // Diffing real changes reads files from disk, which needs the desktop
  // host. Inline (fixture) diffs render anywhere.
  if (desktopOnly) {
    return (
      <CenteredNotice
        message={t('layout.review-desktop-only', {
          defaultValue: 'Change review is available in the desktop app.',
        })}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full gap-2 overflow-hidden p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="h-28 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
          <div className="h-28 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
        </div>
        <div className="w-[248px] shrink-0 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
      </div>
    );
  }

  // A failed scan must not read as "nothing changed" — this surface is what
  // the user checks before trusting the agents' edits.
  if (error) {
    return (
      <CenteredNotice
        message={t('layout.review-scan-failed', {
          defaultValue: runScoped
            ? 'Could not load the changes for this task.'
            : 'Could not load the changes for this project.',
        })}
        detail={error}
        action={
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {t('layout.review-retry', { defaultValue: 'Try again' })}
          </Button>
        }
      />
    );
  }

  if (files.length === 0) {
    return (
      <CenteredNotice
        message={t('layout.review-empty', {
          defaultValue: runScoped
            ? 'No file changes in this task.'
            : 'No file changes in this project yet.',
        })}
        detail={t('layout.review-empty-hint', {
          defaultValue: runScoped
            ? 'This view contains only the files changed by the selected task.'
            : 'Files written by agents will appear here as before / after diffs.',
        })}
        action={
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {t('layout.review-refresh', { defaultValue: 'Refresh' })}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-0 border-b border-solid border-ds-border-neutral-subtle-default px-3">
        <span className="text-sm font-medium text-ds-text-neutral-default-default">
          {t('layout.review-changed-files', {
            defaultValue: '{{count}} changed files',
            count: files.length,
          })}
        </span>
        {totals && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
            <span className="text-ds-text-success-default-default">
              +{totals.added}
            </span>
            <span className="text-ds-text-error-default-default">
              −{totals.removed}
            </span>
          </span>
        )}
        {truncated && (
          <span className="text-xs text-ds-text-neutral-muted-default">
            {t('layout.review-truncated', {
              defaultValue: 'Showing the first 500 files',
            })}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          <TooltipSimple
            content={t('layout.review-refresh', { defaultValue: 'Refresh' })}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={refresh}
              aria-label={t('layout.review-refresh', {
                defaultValue: 'Refresh',
              })}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </TooltipSimple>
          <TooltipSimple content={foldToggleLabel}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={toggleFoldAll}
              aria-pressed={foldAll}
              aria-label={foldToggleLabel}
            >
              {foldAll ? (
                <ListChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ListChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipSimple>
          <TooltipSimple content={treeToggleLabel}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={() => setTreeHidden((hidden) => !hidden)}
              aria-pressed={treeHidden}
              aria-label={treeToggleLabel}
            >
              {/* The icon shows the rail's current state; the tooltip and
                  label carry the action it would take. */}
              {treeHidden ? (
                <FolderClosed className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipSimple>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        {/* Right padding comes from the always-visible 8px scrollbar gutter;
            the left padding matches it so the stack reads centered. */}
        <div
          ref={stackRef}
          className="scrollbar-always-visible flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto py-3 pl-2"
        >
          {files.map((file) => (
            <DiffFileCard
              key={file.id}
              file={file}
              selected={file.id === selectedId}
              appearance={appearance}
              foldAll={foldAll}
              foldNonce={foldNonce}
            />
          ))}
        </div>
        {treeHidden ? null : (
          <ReviewFileTree
            files={files}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );
}

function CenteredNotice({
  message,
  detail,
  action,
}: {
  message: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FileDiff
        className="h-8 w-8 text-ds-icon-neutral-muted-default"
        aria-hidden
      />
      <p className="text-sm text-ds-text-neutral-default-default">{message}</p>
      {detail && (
        <p className="max-w-[380px] text-xs text-ds-text-neutral-muted-default">
          {detail}
        </p>
      )}
      {action}
    </div>
  );
}

export default ReviewTab;
