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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useAuthStore } from '@/store/authStore';
import type {
  SessionReviewComment,
  SessionReviewTab,
  SessionReviewTarget,
} from '@/store/pageTabStore';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  Columns2,
  Copy,
  FileDiff,
  FolderClosed,
  FolderOpen,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Rows3,
  SendHorizontal,
  Trash2,
  WrapText,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DiffFileCard,
  type DiffFileCardHandle,
  type DiffViewMode,
  type ReviewSelection,
} from './review/DiffFileCard';
import { ReviewFileTree } from './review/ReviewFileTree';
import { useReviewChanges } from './review/useReviewChanges';

/**
 * Read-only review workbench. The file rail provides navigation and the center
 * mounts one diff at a time, avoiding the nested scrolling and visual noise of
 * the old stacked-card layout.
 */
const DEFAULT_REVIEW_TARGET: SessionReviewTarget = {
  scope: 'project',
  focusRequestId: 0,
};

const MIN_SPLIT_DIFF_WIDTH = 960;

function normalizedReviewPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function reviewLocation(comment: SessionReviewComment): string {
  const target = comment.selection;
  if (!target) return comment.path;
  const range =
    target.startLine === target.endLine
      ? `${target.startLine}`
      : `${target.startLine}-${target.endLine}`;
  return `${comment.path}:${range} (${target.side})`;
}

function markdownFenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length)
  );
  return '`'.repeat(Math.max(3, longest + 1));
}

export function buildReviewFeedbackPrompt(
  comments: readonly SessionReviewComment[]
): string {
  const entries = comments.map((comment, index) => {
    const excerpt = comment.selection?.text.trim();
    const reference = excerpt
      ? (() => {
          const fence = markdownFenceFor(excerpt);
          return `\n\nReference code:\n${fence}\n${excerpt}\n${fence}`;
        })()
      : '';
    return `${index + 1}. **${reviewLocation(comment)}**\n\n   ${comment.body}${reference}`;
  });
  return [
    'Please address the following code review comments. Preserve unrelated changes and verify the affected behavior after editing.',
    '',
    ...entries,
  ].join('\n');
}

export function ReviewTab({ tab }: { tab: SessionReviewTab }) {
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const updateReviewComments = usePageTabStore(
    (state) => state.updateReviewComments
  );
  const requestWorkspaceChatDraft = usePageTabStore(
    (state) => state.requestWorkspaceChatDraft
  );
  const reviewTarget = tab.reviewTarget ?? DEFAULT_REVIEW_TARGET;
  const [comments, setComments] = useState<SessionReviewComment[]>(
    () => tab.reviewComments ?? []
  );
  const { loading, files, desktopOnly, error, totals, truncated, refresh } =
    useReviewChanges(reviewTarget);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [treeMode, setTreeMode] = useState<'auto' | 'visible' | 'hidden'>(
    'auto'
  );
  const [preferredViewMode, setPreferredViewMode] =
    useState<DiffViewMode>('inline');
  const [wordWrap, setWordWrap] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [commentTarget, setCommentTarget] = useState<ReviewSelection | null>(
    null
  );
  const [noteDraft, setNoteDraft] = useState('');
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [notesCopied, setNotesCopied] = useState(false);
  const [commentsAddedToChat, setCommentsAddedToChat] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<DiffFileCardHandle>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);

  useEffect(() => {
    setComments(tab.reviewComments ?? []);
  }, [tab.id, tab.reviewComments]);

  const persistReviewComments = useCallback(
    (next: SessionReviewComment[]) => {
      setComments(next);
      updateReviewComments(tab.id, next);
    },
    [tab.id, updateReviewComments]
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPanelWidth(panel.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [loading, files.length]);

  const treeAutoHidden =
    files.length === 1 ||
    (panelWidth !== null && panelWidth > 0 && panelWidth < 760);
  const treeHidden =
    treeMode === 'hidden' || (treeMode === 'auto' && treeAutoHidden);
  const viewMode =
    preferredViewMode === 'split' &&
    panelWidth !== null &&
    panelWidth < MIN_SPLIT_DIFF_WIDTH
      ? 'inline'
      : preferredViewMode;

  const selectedIndex = useMemo(
    () => files.findIndex((file) => file.id === selectedId),
    [files, selectedId]
  );
  const selectedFile = selectedIndex >= 0 ? files[selectedIndex] : null;
  const selectedFileNotes = useMemo(
    () => comments.filter((comment) => comment.fileId === selectedFile?.id),
    [comments, selectedFile?.id]
  );
  const pendingComments = useMemo(
    () => comments.filter((comment) => comment.status !== 'sent'),
    [comments]
  );
  const selectedFilePendingCount = useMemo(
    () =>
      selectedFileNotes.reduce(
        (count, comment) => count + Number(comment.status !== 'sent'),
        0
      ),
    [selectedFileNotes]
  );
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of pendingComments) {
      counts.set(comment.fileId, (counts.get(comment.fileId) ?? 0) + 1);
    }
    return counts;
  }, [pendingComments]);
  const reviewedCount = useMemo(
    () =>
      files.reduce(
        (count, file) => count + Number(reviewedIds.has(file.id)),
        0
      ),
    [files, reviewedIds]
  );

  const selectAt = useCallback(
    (index: number) => {
      if (files.length === 0) return;
      const normalizedIndex = (index + files.length) % files.length;
      setSelectedId(files[normalizedIndex].id);
    },
    [files]
  );

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  const handleSelectionChange = useCallback(
    (nextSelection: ReviewSelection | null) => setSelection(nextSelection),
    []
  );

  useEffect(() => {
    if (files.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!files.some((file) => file.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  useEffect(() => {
    setSelection(null);
    setCommentTarget(null);
    setNoteComposerOpen(false);
    setNoteDraft('');
    setEditingCommentId(null);
  }, [selectedId]);

  useEffect(() => {
    const liveIds = new Set(files.map((file) => file.id));
    setReviewedIds((current) => {
      const next = new Set([...current].filter((id) => liveIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

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

  const toggleReviewed = useCallback(() => {
    if (!selectedFile) return;
    const wasReviewed = reviewedIds.has(selectedFile.id);
    setReviewedIds((current) => {
      const next = new Set(current);
      if (next.has(selectedFile.id)) next.delete(selectedFile.id);
      else next.add(selectedFile.id);
      return next;
    });
    if (!wasReviewed && files.length > 1) {
      for (let offset = 1; offset < files.length; offset += 1) {
        const candidateIndex = (selectedIndex + offset) % files.length;
        if (!reviewedIds.has(files[candidateIndex].id)) {
          selectAt(candidateIndex);
          break;
        }
      }
    }
  }, [files, reviewedIds, selectAt, selectedFile, selectedIndex]);

  const openCommentComposer = useCallback(
    (target: ReviewSelection | null = selection) => {
      setCommentTarget(target);
      setEditingCommentId(null);
      setNoteDraft('');
      setNoteComposerOpen(true);
    },
    [selection]
  );

  const requestLineComment = useCallback((target: ReviewSelection) => {
    setSelection(target);
    setCommentTarget(target);
    setEditingCommentId(null);
    setNoteDraft('');
    setNoteComposerOpen(true);
  }, []);

  const closeCommentComposer = useCallback(() => {
    setNoteComposerOpen(false);
    setNoteDraft('');
    setEditingCommentId(null);
    setCommentTarget(null);
  }, []);

  const saveComment = useCallback(() => {
    const body = noteDraft.trim();
    if (!selectedFile || !body) return;
    const next = editingCommentId
      ? comments.map((comment) =>
          comment.id === editingCommentId
            ? {
                ...comment,
                body,
                selection: commentTarget,
                status: 'pending' as const,
                sentAt: undefined,
              }
            : comment
        )
      : [
          ...comments,
          {
            id: `${selectedFile.id}:${Date.now()}`,
            fileId: selectedFile.id,
            path: selectedFile.path,
            selection: commentTarget,
            body,
            createdAt: Date.now(),
          },
        ];
    persistReviewComments(next);
    closeCommentComposer();
  }, [
    closeCommentComposer,
    commentTarget,
    comments,
    editingCommentId,
    noteDraft,
    selectedFile,
    persistReviewComments,
  ]);

  const editComment = useCallback((comment: SessionReviewComment) => {
    setEditingCommentId(comment.id);
    setCommentTarget(comment.selection);
    setNoteDraft(comment.body);
    setNoteComposerOpen(true);
    if (comment.selection) diffRef.current?.revealSelection(comment.selection);
  }, []);

  const deleteComment = useCallback(
    (commentId: string) => {
      persistReviewComments(
        comments.filter((comment) => comment.id !== commentId)
      );
      if (editingCommentId === commentId) closeCommentComposer();
    },
    [closeCommentComposer, comments, editingCommentId, persistReviewComments]
  );

  const copyNotes = useCallback(() => {
    if (!navigator.clipboard?.writeText || comments.length === 0) return;
    const markdown = buildReviewFeedbackPrompt(comments);
    void navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setNotesCopied(true);
        window.setTimeout(() => setNotesCopied(false), 1500);
      })
      .catch(() => undefined);
  }, [comments]);

  const addCommentsToChat = useCallback(() => {
    if (pendingComments.length === 0) return;
    requestWorkspaceChatDraft(buildReviewFeedbackPrompt(pendingComments), {
      reviewTabId: tab.id,
      commentIds: pendingComments.map((comment) => comment.id),
    });
    setCommentsAddedToChat(true);
    window.setTimeout(() => setCommentsAddedToChat(false), 1800);
  }, [pendingComments, requestWorkspaceChatDraft, tab.id]);

  const treeToggleLabel = treeHidden
    ? t('layout.review-show-tree', { defaultValue: 'Show file tree' })
    : t('layout.review-hide-tree', { defaultValue: 'Hide file tree' });
  const runScoped = reviewTarget.scope === 'run';

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
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <div className="w-[248px] shrink-0 animate-pulse border-0 border-y-0 border-r border-l-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default" />
        <div className="m-3 min-w-0 flex-1 animate-pulse rounded-lg bg-ds-neutral-subtle-default" />
      </div>
    );
  }

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
    <div
      ref={panelRef}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-ds-neutral-default-default"
    >
      <div className="flex h-ds-layout-row-header shrink-0 items-center gap-2 border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-ds-10">
        <TooltipSimple content={treeToggleLabel}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setTreeMode(treeHidden ? 'visible' : 'hidden')}
            aria-pressed={treeHidden}
            aria-label={treeToggleLabel}
          >
            {treeHidden ? (
              <FolderClosed aria-hidden />
            ) : (
              <FolderOpen aria-hidden />
            )}
          </Button>
        </TooltipSimple>

        <span className="hidden text-ds-text-meta font-medium text-ds-ink-default-default sm:inline">
          {runScoped
            ? t('layout.review-task-changes', { defaultValue: 'Task changes' })
            : t('layout.review-project-changes', {
                defaultValue: 'Project changes',
              })}
        </span>
        <span className="shrink-0 text-ds-text-meta text-ds-ink-muted-default">
          {selectedIndex + 1}/{files.length}
        </span>
        {totals && (
          <span className="hidden shrink-0 items-center gap-1.5 text-ds-text-meta font-medium md:flex">
            <span className="text-ds-text-success-default-default">
              +{totals.added}
            </span>
            <span className="text-ds-text-error-default-default">
              −{totals.removed}
            </span>
          </span>
        )}
        {truncated && (
          <span className="hidden text-ds-text-meta text-ds-ink-muted-default xl:inline">
            {t('layout.review-truncated', {
              defaultValue: 'Showing the first 500 files',
            })}
          </span>
        )}

        <div className="h-4 w-px shrink-0 bg-ds-hairline-subtle-default" />
        <TooltipSimple
          content={t('layout.review-previous-file', {
            defaultValue: 'Previous file',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => selectAt(selectedIndex - 1)}
            aria-label={t('layout.review-previous-file', {
              defaultValue: 'Previous file',
            })}
          >
            <ArrowUp aria-hidden />
          </Button>
        </TooltipSimple>

        <TooltipSimple
          content={t('layout.review-next-file', { defaultValue: 'Next file' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => selectAt(selectedIndex + 1)}
            aria-label={t('layout.review-next-file', {
              defaultValue: 'Next file',
            })}
          >
            <ArrowDown aria-hidden />
          </Button>
        </TooltipSimple>

        <div className="flex-1" />

        <span className="hidden text-ds-text-meta text-ds-ink-muted-default lg:inline">
          {t('layout.review-reviewed-progress', {
            defaultValue: '{{reviewed}} of {{total}} reviewed',
            reviewed: reviewedCount,
            total: files.length,
          })}
        </span>
        <TooltipSimple
          content={
            selectedFile && reviewedIds.has(selectedFile.id)
              ? t('layout.review-mark-unreviewed', {
                  defaultValue: 'Mark as unreviewed',
                })
              : t('layout.review-mark-reviewed', {
                  defaultValue: 'Mark as reviewed',
                })
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={toggleReviewed}
            aria-pressed={Boolean(
              selectedFile && reviewedIds.has(selectedFile.id)
            )}
            aria-label={
              selectedFile && reviewedIds.has(selectedFile.id)
                ? t('layout.review-mark-unreviewed', {
                    defaultValue: 'Mark as unreviewed',
                  })
                : t('layout.review-mark-reviewed', {
                    defaultValue: 'Mark as reviewed',
                  })
            }
          >
            {selectedFile && reviewedIds.has(selectedFile.id) ? (
              <CheckCheck
                className="text-ds-icon-success-default-default"
                aria-hidden
              />
            ) : (
              <Check aria-hidden />
            )}
          </Button>
        </TooltipSimple>

        <TooltipSimple
          content={t('layout.review-add-note', {
            defaultValue: selection
              ? 'Comment on the selected lines'
              : 'Add a file review note',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() =>
              noteComposerOpen ? closeCommentComposer() : openCommentComposer()
            }
            aria-pressed={noteComposerOpen}
            aria-label={t('layout.review-add-note', {
              defaultValue: selection
                ? 'Comment on the selected lines'
                : 'Add a file review note',
            })}
          >
            <MessageSquarePlus aria-hidden />
          </Button>
        </TooltipSimple>
        {comments.length > 0 ? (
          <TooltipSimple
            content={t('layout.review-copy-notes', {
              defaultValue: notesCopied ? 'Copied' : 'Copy review comments',
            })}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={copyNotes}
              aria-label={t('layout.review-copy-notes', {
                defaultValue: notesCopied ? 'Copied' : 'Copy review comments',
              })}
            >
              <Copy aria-hidden />
            </Button>
          </TooltipSimple>
        ) : null}
        {pendingComments.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCommentsToChat}
            aria-label={t('layout.review-add-comments-to-chat', {
              defaultValue: 'Add {{count}} comments to chat',
              count: pendingComments.length,
            })}
          >
            <SendHorizontal aria-hidden />
            <span className="hidden xl:inline">
              {commentsAddedToChat
                ? t('layout.review-comments-added-to-chat', {
                    defaultValue: 'Added to chat',
                  })
                : t('layout.review-send-comments', {
                    defaultValue: 'Send {{count}} comments',
                    count: pendingComments.length,
                  })}
            </span>
            <span className="xl:hidden">{pendingComments.length}</span>
          </Button>
        ) : null}

        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value) setPreferredViewMode(value as DiffViewMode);
          }}
          size="sm"
          className="hidden md:flex"
          aria-label={t('layout.review-diff-layout', {
            defaultValue: 'Diff layout',
          })}
        >
          <ToggleGroupItem
            value="inline"
            aria-label={t('layout.review-inline-diff', {
              defaultValue: 'Inline diff',
            })}
          >
            <Rows3 aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="split"
            aria-label={t('layout.review-split-diff', {
              defaultValue: 'Split diff',
            })}
            disabled={panelWidth !== null && panelWidth < MIN_SPLIT_DIFF_WIDTH}
          >
            <Columns2 aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>

        <TooltipSimple
          content={
            wordWrap
              ? t('layout.review-disable-word-wrap', {
                  defaultValue: 'Disable word wrap',
                })
              : t('layout.review-enable-word-wrap', {
                  defaultValue: 'Enable word wrap',
                })
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setWordWrap((value) => !value)}
            aria-pressed={wordWrap}
            aria-label={
              wordWrap
                ? t('layout.review-disable-word-wrap', {
                    defaultValue: 'Disable word wrap',
                  })
                : t('layout.review-enable-word-wrap', {
                    defaultValue: 'Enable word wrap',
                  })
            }
          >
            <WrapText aria-hidden />
          </Button>
        </TooltipSimple>

        <div className="hidden h-4 w-px shrink-0 bg-ds-hairline-subtle-default md:block" />
        <TooltipSimple
          content={t('layout.review-previous-change', {
            defaultValue: 'Previous change',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => diffRef.current?.goToDiff('previous')}
            aria-label={t('layout.review-previous-change', {
              defaultValue: 'Previous change',
            })}
          >
            <ArrowUp aria-hidden />
          </Button>
        </TooltipSimple>
        <TooltipSimple
          content={t('layout.review-next-change', {
            defaultValue: 'Next change',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => diffRef.current?.goToDiff('next')}
            aria-label={t('layout.review-next-change', {
              defaultValue: 'Next change',
            })}
          >
            <ArrowDown aria-hidden />
          </Button>
        </TooltipSimple>

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
            <RefreshCw aria-hidden />
          </Button>
        </TooltipSimple>
      </div>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        {treeHidden ? null : (
          <ReviewFileTree
            files={files}
            selectedId={selectedId}
            reviewedIds={reviewedIds}
            commentCounts={commentCounts}
            onSelect={handleSelect}
          />
        )}
        <main
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
          aria-live="polite"
        >
          {selectedFile ? (
            <>
              <div className="min-h-0 flex-1">
                <DiffFileCard
                  ref={diffRef}
                  key={selectedFile.id}
                  file={selectedFile}
                  appearance={appearance}
                  viewMode={viewMode}
                  wordWrap={wordWrap}
                  reviewed={reviewedIds.has(selectedFile.id)}
                  comments={selectedFileNotes}
                  onSelectionChange={handleSelectionChange}
                  onCommentRequest={requestLineComment}
                />
              </div>
              {selectedFileNotes.length > 0 || noteComposerOpen ? (
                <div className="max-h-[42%] shrink-0 overflow-y-auto border-0 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default">
                  {selectedFileNotes.length > 0 ? (
                    <div className="divide-y divide-ds-hairline-subtle-default">
                      <div className="flex items-center justify-between px-3 py-2 text-ds-text-meta font-medium text-ds-ink-default-default">
                        <span>
                          {t('layout.review-pending-comments', {
                            defaultValue: 'Review comments',
                          })}
                        </span>
                        <span className="text-ds-ink-muted-default">
                          {selectedFilePendingCount > 0
                            ? t('layout.review-comments-pending-count', {
                                defaultValue: '{{count}} pending',
                                count: selectedFilePendingCount,
                              })
                            : t('layout.review-comments-all-sent', {
                                defaultValue: 'All sent',
                              })}
                        </span>
                      </div>
                      {selectedFileNotes.map((comment) => (
                        <article
                          key={comment.id}
                          className="group flex items-start gap-2 px-3 py-2.5"
                        >
                          {comment.status === 'sent' ? (
                            <DsIcon
                              icon={CheckCheck}
                              recipe="main-compact"
                              className="mt-0.5 text-ds-icon-success-default-default"
                            />
                          ) : (
                            <DsIcon
                              icon={MessageSquarePlus}
                              recipe="main-compact"
                              className="mt-0.5 text-ds-icon-brand-default-default"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <Button
                                type="button"
                                variant="text"
                                size="xs"
                                className="min-w-0 justify-start truncate font-code"
                                onClick={() => {
                                  if (comment.selection) {
                                    diffRef.current?.revealSelection(
                                      comment.selection
                                    );
                                  }
                                }}
                              >
                                {reviewLocation(comment)}
                              </Button>
                              {comment.status === 'sent' ? (
                                <Badge
                                  variant="secondary"
                                  tone="success"
                                  size="xs"
                                  className="shrink-0"
                                >
                                  {t('layout.review-comment-sent', {
                                    defaultValue: 'Sent',
                                  })}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="m-0 mt-1 text-ds-text-base break-words whitespace-pre-wrap text-ds-ink-default-default">
                              {comment.body}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              buttonContent="icon-only"
                              onClick={() => editComment(comment)}
                              aria-label={t('layout.review-edit-comment', {
                                defaultValue: 'Edit review comment',
                              })}
                            >
                              <Pencil aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              buttonContent="icon-only"
                              onClick={() => deleteComment(comment.id)}
                              aria-label={t('layout.review-delete-comment', {
                                defaultValue: 'Delete review comment',
                              })}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}

                  {noteComposerOpen ? (
                    <div className="border-0 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default p-3 first:border-x-0 first:border-t-0 first:border-b-0">
                      <div className="mb-2 flex items-center gap-2 text-ds-text-meta text-ds-ink-muted-default">
                        <DsIcon
                          icon={MessageSquarePlus}
                          recipe="main-compact"
                        />
                        <span className="min-w-0 flex-1 truncate font-code">
                          {commentTarget
                            ? `${selectedFile.path}:${commentTarget.startLine}${
                                commentTarget.endLine ===
                                commentTarget.startLine
                                  ? ''
                                  : `-${commentTarget.endLine}`
                              } (${commentTarget.side})`
                            : selectedFile.path}
                        </span>
                      </div>
                      <Textarea
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        placeholder={t('layout.review-note-placeholder', {
                          defaultValue: 'Describe what should change…',
                        })}
                        aria-label={t('layout.review-note-placeholder', {
                          defaultValue: 'Describe what should change…',
                        })}
                        className="min-h-ds-20 resize-none"
                        autoFocus
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={closeCommentComposer}
                        >
                          {t('common.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!noteDraft.trim()}
                          onClick={saveComment}
                        >
                          {editingCommentId
                            ? t('layout.review-update-comment', {
                                defaultValue: 'Update comment',
                              })
                            : t('layout.review-add-note-action', {
                                defaultValue: 'Add comment',
                              })}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </main>
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
    <div className="flex h-full min-h-0 w-full -translate-y-4 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-ds-neutral-subtle-default">
        <DsIcon
          icon={FileDiff}
          recipe="detailed"
          className="text-ds-ink-muted-default"
        />
      </div>
      <p className="m-0 text-ds-text-base font-medium text-ds-ink-default-default">
        {message}
      </p>
      {detail && (
        <p className="m-0 text-ds-text-meta text-ds-ink-muted-default">
          {detail}
        </p>
      )}
      {action}
    </div>
  );
}

export default ReviewTab;
