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

import { useHost } from '@/host';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import {
  proxyFetchSpaceProjectOverlays,
  type SpaceOverlay,
} from '@/service/spaceApi';
import {
  fetchProjectGitChangeBlob,
  fetchProjectGitChangeContent,
  fetchProjectGitChanges,
  fetchRunGitChangeBlob,
  fetchRunGitChangeContent,
  fetchRunGitChanges,
  type ProjectGitChanges,
  type RunGitChangesUnavailable,
} from '@/service/workspaceGitApi';
import { useAuthStore } from '@/store/authStore';
import {
  usePageTabStore,
  type SessionReviewIdentity,
  type SessionReviewTarget,
} from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { countLineDiff, type LineCounts } from './diffMetrics';
import {
  decodeFileText,
  diffSidePaths,
  isRasterImagePreviewPath,
} from './reviewContent';
import { REVIEW_FIXTURE_FILES, reviewFixtureEnabled } from './reviewFixture';
import { collectChangedFilePaths } from './reviewSources';

export type ReviewFileStatus = 'added' | 'modified' | 'deleted';

/**
 * Files above this size are not diffed (keeps Monaco responsive, and avoids
 * shipping a huge buffer over IPC just to reject it in the renderer).
 */
export const MAX_DIFF_BYTES = 2_000_000;

/** Images are rendered, not diffed as text, so they have a separate budget. */
export const MAX_IMAGE_PREVIEW_BYTES = 20_000_000;

const isRunGitChangesUnavailable = (
  value: ProjectGitChanges | RunGitChangesUnavailable
): value is RunGitChangesUnavailable =>
  'available' in value && value.available === false;

/** One changed file of the current project, ready for the diff view. */
export interface ReviewFile {
  /** Stable identity; display paths are not guaranteed to be unique. */
  id: string;
  /** Display path (relative to the project root when under it). */
  path: string;
  status: ReviewFileStatus;
  /** Absolute path of the file's current on-disk version. */
  absPath: string;
  /**
   * Absolute path of the backup holding the "before" content — the earliest
   * `.bak` the agent file toolkit made next to the file. Null when the file
   * never had one (added files, or deletions that skipped backup).
   */
  bakPath: string | null;
  /**
   * A modified file whose before-content could not be found (the run recorded
   * the change, but no backup survives). The card shows the current content
   * uncompared instead of diffing it against nothing.
   */
  beforeUnavailable?: boolean;
  /** Git reported a binary path; no text content request is needed. */
  binary?: boolean;
  /** Side sizes power binary/large-file summaries without reading content. */
  beforeSize?: number | null;
  afterSize?: number | null;
  /** A text side exceeds `MAX_DIFF_BYTES`; the card skips reading it. */
  tooLarge?: boolean;
  /** A raster image side exceeds `MAX_IMAGE_PREVIEW_BYTES`. */
  previewTooLarge?: boolean;
  /**
   * Inline diff sides (dev fixture only). When set, the card diffs these
   * strings instead of reading files from disk.
   */
  inline?: { original: string; modified: string };
  /** Lazily loads authoritative Git content for this one visible card. */
  loadContent?: () => Promise<{ original: string; modified: string }>;
  /** Lazily loads one binary image side from its exact pinned Git commit. */
  loadPreview?: (side: 'before' | 'after') => Promise<Blob>;
}

export interface ReviewChangesState {
  loading: boolean;
  /** Changed files of this project, sorted by display path. */
  files: ReviewFile[];
  /** The real review data requires Electron filesystem access. */
  desktopOnly: boolean;
  /**
   * Set when the scan itself failed. Kept separate from an empty `files` so
   * the tab never reports "no changes" for what is really a lookup failure.
   */
  error: string | null;
  /**
   * Added/removed lines across every changed file, or null while still being
   * computed. Files that cannot be diffed (too large, binary, or missing their
   * before-side) contribute nothing.
   */
  totals: LineCounts | null;
  /** More files changed than the bounded list returned by the backend. */
  truncated?: boolean;
  reviewIdentity: SessionReviewIdentity | null;
  /** Target key that produced `reviewIdentity`; prevents cross-target reuse. */
  reviewIdentityTargetKey?: string | null;
  stale: boolean;
  refresh: () => void;
}

interface LoadedReviewFiles {
  files: ReviewFile[];
  totals: LineCounts | null;
  truncated: boolean;
  desktopOnly: boolean;
  reviewIdentity: SessionReviewIdentity | null;
  stale: boolean;
}

/** Shape returned by the `review-list-backups` IPC (electron/main/reviewChanges.ts). */
interface ReviewBackup {
  path: string;
  size: number;
}

interface ReviewBackupEntry {
  path: string;
  exists: boolean;
  size: number | null;
  backups: ReviewBackup[];
}

function displayPath(absPath: string, rootPath: string | null): string {
  const normalizedPath = absPath.replace(/\\/g, '/');
  if (rootPath) {
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalizedPath.startsWith(`${normalizedRoot}/`))
      return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function samePaths(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function joinFilePath(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relativePath.replace(/^[\\/]+/, '')}`.replace(
    /\\/g,
    '/'
  );
}

function overlaySourcePath(overlay: SpaceOverlay): string | null {
  const sourcePath = metadataString(overlay.metadata, 'source_path');
  if (sourcePath) return sourcePath.replace(/\\/g, '/');
  const sourceRoot = metadataString(overlay.metadata, 'source_root');
  return sourceRoot ? joinFilePath(sourceRoot, overlay.path) : null;
}

function isReviewStatus(value: string): value is ReviewFileStatus {
  return value === 'added' || value === 'modified' || value === 'deleted';
}

/**
 * Flags the diff card needs before it reads anything: whether the before-side
 * content is missing outright, and whether either side is too big to diff.
 */
function reviewFileFlags(
  path: string,
  status: ReviewFileStatus,
  bakPath: string | null,
  beforeSize: number | null,
  afterSize: number | null
): Pick<ReviewFile, 'beforeUnavailable' | 'tooLarge' | 'previewTooLarge'> {
  const largestSide = Math.max(beforeSize ?? 0, afterSize ?? 0);
  const usesImagePreview = isRasterImagePreviewPath(path);
  return {
    beforeUnavailable: status === 'modified' && !bakPath,
    tooLarge: !usesImagePreview && largestSide > MAX_DIFF_BYTES,
    ...(usesImagePreview
      ? { previewTooLarge: largestSide > MAX_IMAGE_PREVIEW_BYTES }
      : {}),
  };
}

/**
 * Before/after changes for the session's project. Server-backed copy/worktree
 * projects use their authoritative pending overlays; direct-write projects
 * fall back to WRITE_FILE history and the toolkit's on-disk backups.
 */
export function useReviewChanges(
  reviewTarget: SessionReviewTarget = {
    scope: 'project',
    focusRequestId: 0,
  },
  pinnedIdentity?: SessionReviewIdentity
): ReviewChangesState {
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const reviewScope = reviewTarget.scope;
  const focusRequestId = reviewTarget.focusRequestId;
  const runId = reviewScope === 'run' ? reviewTarget.runId?.trim() : undefined;
  const reviewTargetKey =
    reviewScope === 'run' ? `run:${reviewTarget.runId ?? ''}` : 'project';
  const pinnedBaseCommit = pinnedIdentity?.baseCommit;
  const pinnedTargetCommit = pinnedIdentity?.targetCommit;
  const hasPinnedIdentity = Boolean(pinnedBaseCommit && pinnedTargetCommit);
  const projectStore = useProjectRuntimeStore();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const projectMeta = useSpaceStore((state) =>
    projectId ? state.getProjectMeta(projectId) : null
  );
  const runtimeProject = projectId
    ? projectStore.getProjectById(projectId)
    : null;
  const spaceId =
    projectMeta?.spaceId ?? runtimeProject?.spaceId ?? activeSpaceId ?? null;
  const projectSpace = useSpaceStore((state) =>
    spaceId ? state.spaces[spaceId] : null
  );
  const spaceRootPath = projectSpace?.rootPath ?? null;
  const workdirMode =
    projectMeta?.workdirMode ?? runtimeProject?.workdirMode ?? null;
  const directWrite =
    workdirMode === 'direct-write' ||
    (!workdirMode && isLocalWorkspaceSpace(projectSpace));
  const serverBacked = Boolean(
    projectMeta?.metadata?.serverSynced ||
    projectMeta?.metadata?.historyId ||
    runtimeProject?.metadata?.serverSynced ||
    runtimeProject?.metadata?.historyId
  );
  const overlayBacked = Boolean(
    spaceId && !spaceId.startsWith('legacy_') && serverBacked && !directWrite
  );

  // Written-file paths, kept live across all of the project's chat stores
  // (same subscription pattern as the terminal tab's stream collector).
  const chatEntries = useMemo(
    () => (projectId ? projectStore.getAllChatStores(projectId) : []),
    [projectStore, projectId]
  );
  const computePaths = useCallback(
    () =>
      collectChangedFilePaths(
        chatEntries.map(({ chatStore }) => ({
          tasks: chatStore.getState().tasks,
        })),
        runId
      ),
    [chatEntries, runId]
  );
  const [changedPaths, setChangedPaths] = useState<string[]>(computePaths);
  useEffect(() => {
    const updatePaths = () => {
      const next = computePaths();
      setChangedPaths((current) => (samePaths(current, next) ? current : next));
    };
    updatePaths();
    const unsubscribes = chatEntries.map(({ chatStore }) =>
      chatStore.subscribe(updatePaths)
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chatEntries, computePaths]);

  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desktopOnly, setDesktopOnly] = useState(false);
  const [gitTotals, setGitTotals] = useState<LineCounts | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [reviewIdentityResult, setReviewIdentityResult] = useState<{
    targetKey: string;
    identity: SessionReviewIdentity | null;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setFetchNonce((n) => n + 1);
  }, []);
  const fixtureEnabled = reviewFixtureEnabled();
  const api = host?.electronAPI;
  const gitEligible = Boolean(
    projectId &&
    spaceId &&
    email &&
    !spaceId.startsWith('legacy_') &&
    (reviewScope === 'project' || runId)
  );

  useEffect(() => {
    if (fixtureEnabled) {
      setFiles(REVIEW_FIXTURE_FILES);
      setGitTotals(null);
      setTruncated(false);
      setReviewIdentityResult({ targetKey: reviewTargetKey, identity: null });
      setStale(false);
      setDesktopOnly(false);
      setError(null);
      setLoading(false);
      return;
    }
    if (reviewScope === 'run' && !runId) {
      setFiles([]);
      setGitTotals(null);
      setTruncated(false);
      setReviewIdentityResult({ targetKey: reviewTargetKey, identity: null });
      setStale(false);
      setDesktopOnly(false);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDesktopOnly(false);
    setGitTotals(null);
    setTruncated(false);

    const loadLegacyFiles = async (): Promise<LoadedReviewFiles> => {
      if (!api?.reviewListBackups || !api?.readFile) {
        return {
          files: [],
          totals: null,
          truncated: false,
          desktopOnly: true,
          reviewIdentity: null,
          stale: false,
        };
      }
      if (overlayBacked) {
        if (!spaceId) {
          return {
            files: [],
            totals: null,
            truncated: false,
            desktopOnly: false,
            reviewIdentity: null,
            stale: false,
          };
        }
        const response = await proxyFetchSpaceProjectOverlays(
          spaceId,
          projectId ?? ''
        );
        const overlays = response.overlays.filter(
          (overlay) =>
            isReviewStatus(overlay.status) &&
            (!runId || overlay.run_id === runId)
        );
        const sourcePaths = Array.from(
          new Set(
            overlays
              .map(overlaySourcePath)
              .filter((path): path is string => Boolean(path))
          )
        );
        const entries = sourcePaths.length
          ? ((await api.reviewListBackups(sourcePaths)) as ReviewBackupEntry[])
          : [];
        const entriesByPath = new Map(
          entries.map((entry) => [entry.path.replace(/\\/g, '/'), entry])
        );

        const files = overlays.map((overlay): ReviewFile => {
          const sourcePath = overlaySourcePath(overlay);
          const entry = sourcePath ? entriesByPath.get(sourcePath) : undefined;
          const status = overlay.status as ReviewFileStatus;
          // The first backup is the run's baseline before any writes. For a
          // pending deletion, an existing source is also valid before-side
          // content when the delete operation did not remove the work copy.
          const backup = entry?.backups[0] ?? null;
          const deletedSource =
            status === 'deleted' && entry?.exists && sourcePath
              ? { path: sourcePath, size: entry.size ?? 0 }
              : null;
          const before = backup ?? deletedSource;
          const afterSize = status === 'deleted' ? null : (entry?.size ?? null);
          return {
            id: `overlay:${overlay.run_id}:${overlay.path}`,
            path: overlay.path,
            status,
            absPath: sourcePath ?? '',
            bakPath: before?.path ?? null,
            beforeSize: before?.size ?? null,
            afterSize,
            ...reviewFileFlags(
              overlay.path,
              status,
              before?.path ?? null,
              before?.size ?? null,
              afterSize
            ),
          };
        });
        return {
          files,
          totals: null,
          truncated: false,
          desktopOnly: false,
          reviewIdentity: null,
          stale: false,
        };
      }

      if (changedPaths.length === 0) {
        return {
          files: [],
          totals: null,
          truncated: false,
          desktopOnly: false,
          reviewIdentity: null,
          stale: false,
        };
      }
      const entries = (await api.reviewListBackups(
        changedPaths
      )) as ReviewBackupEntry[];
      const files = entries.map((entry): ReviewFile => {
        const status: ReviewFileStatus = entry.exists
          ? entry.backups.length > 0
            ? 'modified'
            : 'added'
          : 'deleted';
        // The earliest backup is the baseline for both modifications and
        // deletions; a later backup is already an intermediate agent write.
        const backup = entry.backups[0] ?? null;
        return {
          id: `file:${entry.path.replace(/\\/g, '/')}`,
          path: displayPath(entry.path, spaceRootPath),
          status,
          absPath: entry.path,
          bakPath: backup?.path ?? null,
          beforeSize: backup?.size ?? null,
          afterSize: entry.exists ? entry.size : null,
          ...reviewFileFlags(
            displayPath(entry.path, spaceRootPath),
            status,
            backup?.path ?? null,
            backup?.size ?? null,
            entry.size
          ),
        };
      });
      return {
        files,
        totals: null,
        truncated: false,
        desktopOnly: false,
        reviewIdentity: null,
        stale: false,
      };
    };

    const loadFiles = async (): Promise<LoadedReviewFiles> => {
      if (gitEligible && projectId && spaceId && email) {
        try {
          const identity = { email, userId };
          const response = runId
            ? await fetchRunGitChanges(runId, spaceId, identity)
            : await fetchProjectGitChanges(projectId, spaceId, identity);
          if (isRunGitChangesUnavailable(response)) {
            if (hasPinnedIdentity) {
              return {
                files: [],
                totals: null,
                truncated: false,
                desktopOnly: false,
                reviewIdentity: null,
                stale: true,
              };
            }
            return loadLegacyFiles();
          }
          const currentIdentity =
            response.base_commit && response.target_commit
              ? {
                  baseCommit: response.base_commit,
                  targetCommit: response.target_commit,
                }
              : null;
          const identityChanged = Boolean(
            pinnedBaseCommit &&
            pinnedTargetCommit &&
            (!currentIdentity ||
              pinnedBaseCommit !== currentIdentity.baseCommit ||
              pinnedTargetCommit !== currentIdentity.targetCommit)
          );
          if (identityChanged) {
            return {
              files: [],
              totals: response.totals,
              truncated: response.truncated,
              desktopOnly: false,
              reviewIdentity: currentIdentity,
              stale: true,
            };
          }
          const files = response.files.map((file): ReviewFile => {
            const baseCommit = response.base_commit;
            const targetCommit = response.target_commit;
            const largestSide = Math.max(
              file.before_size ?? 0,
              file.after_size ?? 0
            );
            const usesImagePreview = isRasterImagePreviewPath(file.path);
            return {
              id: `${runId ? `run-git:${runId}` : 'git'}:${file.path}`,
              path: file.path,
              status: file.status,
              absPath: '',
              bakPath: null,
              binary: file.binary,
              beforeSize: file.before_size,
              afterSize: file.after_size,
              tooLarge: !usesImagePreview && largestSide > MAX_DIFF_BYTES,
              ...(usesImagePreview
                ? {
                    previewTooLarge: largestSide > MAX_IMAGE_PREVIEW_BYTES,
                  }
                : {}),
              loadContent:
                baseCommit && targetCommit
                  ? async () => {
                      const input = {
                        path: file.path,
                        baseCommit,
                        targetCommit,
                      };
                      const content = runId
                        ? await fetchRunGitChangeContent(
                            runId,
                            spaceId,
                            identity,
                            input
                          )
                        : await fetchProjectGitChangeContent(
                            projectId,
                            spaceId,
                            identity,
                            input
                          );
                      if (content.before.too_large || content.after.too_large) {
                        throw new Error('too_large');
                      }
                      if (content.before.binary || content.after.binary) {
                        throw new Error('binary');
                      }
                      return {
                        original: content.before.content ?? '',
                        modified: content.after.content ?? '',
                      };
                    }
                  : undefined,
              loadPreview:
                file.binary && baseCommit && targetCommit
                  ? async (side) => {
                      const input = {
                        path: file.path,
                        side,
                        baseCommit,
                        targetCommit,
                      };
                      return runId
                        ? fetchRunGitChangeBlob(runId, spaceId, identity, input)
                        : fetchProjectGitChangeBlob(
                            projectId,
                            spaceId,
                            identity,
                            input
                          );
                    }
                  : undefined,
            };
          });
          return {
            files,
            totals: response.totals,
            truncated: response.truncated,
            desktopOnly: false,
            reviewIdentity: currentIdentity,
            stale: false,
          };
        } catch (cause: unknown) {
          const status = (cause as { status?: number })?.status;
          // A materialized Run has no authoritative commit range until it is
          // finalized, so the Run changes endpoint returns 409 while work is
          // still in progress. An unpinned review can keep showing the live
          // overlay/backup view; a pinned review must remain fail-closed.
          const runStillFinalizing = Boolean(runId) && status === 409;
          if (status !== 404 && !runStillFinalizing) throw cause;
          if (hasPinnedIdentity) {
            return {
              files: [],
              totals: null,
              truncated: false,
              desktopOnly: false,
              reviewIdentity: null,
              stale: true,
            };
          }
        }
      }
      return loadLegacyFiles();
    };

    loadFiles()
      .then((result) => {
        if (cancelled) return;
        const next = result.files;
        next.sort(
          (a: ReviewFile, b: ReviewFile) =>
            a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
        );
        setFiles(next);
        setGitTotals(result.totals);
        setTruncated(result.truncated);
        setDesktopOnly(result.desktopOnly);
        setReviewIdentityResult({
          targetKey: reviewTargetKey,
          identity: result.reviewIdentity,
        });
        setStale(result.stale);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.error('[ReviewTab] Failed to scan changed files:', cause);
        setFiles([]);
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    changedPaths,
    email,
    fetchNonce,
    fixtureEnabled,
    focusRequestId,
    gitEligible,
    hasPinnedIdentity,
    overlayBacked,
    pinnedBaseCommit,
    pinnedTargetCommit,
    projectId,
    reviewScope,
    reviewTargetKey,
    runId,
    spaceId,
    spaceRootPath,
    userId,
  ]);

  // Totals are computed here rather than gathered from the cards: a card only
  // measures its diff once Monaco mounts, which the stack defers until the card
  // nears the viewport, so a header fed from them would climb as the user
  // scrolled. Reading every file once up front keeps the number whole.
  const [totals, setTotals] = useState<LineCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTotals(null);
    if (gitTotals) {
      setTotals(gitTotals);
      return;
    }
    if (files.length === 0) {
      setTotals({ added: 0, removed: 0 });
      return;
    }

    const readSide = async (path: string | null): Promise<string | null> => {
      if (!path) return '';
      if (!api?.readFile) return null;
      const result = await api.readFile(path);
      if (!result?.success) return null;
      return decodeFileText(result.data);
    };

    const run = async () => {
      let added = 0;
      let removed = 0;
      for (const file of files) {
        if (cancelled) return;
        // Nothing trustworthy to count: no baseline, or never diffed at all.
        if (file.binary || file.tooLarge || file.beforeUnavailable) continue;
        let sides: { original: string; modified: string } | null = null;
        if (file.inline) {
          sides = file.inline;
        } else {
          const { original, modified } = diffSidePaths(file);
          const [before, after] = await Promise.all([
            readSide(original),
            readSide(modified),
          ]);
          // Binary or unreadable — excluded rather than counted as empty.
          if (before === null || after === null) continue;
          sides = { original: before, modified: after };
        }
        const counts = countLineDiff(sides.original, sides.modified);
        if (!counts) continue;
        added += counts.added;
        removed += counts.removed;
      }
      if (!cancelled) setTotals({ added, removed });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [api, files, gitTotals]);

  return {
    loading,
    files,
    desktopOnly,
    error,
    totals,
    truncated,
    reviewIdentity: reviewIdentityResult?.identity ?? null,
    reviewIdentityTargetKey: reviewIdentityResult?.targetKey ?? null,
    stale,
    refresh,
  };
}
