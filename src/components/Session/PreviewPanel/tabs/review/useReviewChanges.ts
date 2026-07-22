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
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { REVIEW_FIXTURE_FILES, reviewFixtureEnabled } from './reviewFixture';
import { collectChangedFilePaths } from './reviewSources';

export type ReviewFileStatus = 'added' | 'modified' | 'deleted';

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
   * Inline diff sides (dev fixture only). When set, the card diffs these
   * strings instead of reading files from disk.
   */
  inline?: { original: string; modified: string };
}

export interface ReviewChangesState {
  loading: boolean;
  /** Changed files of this project, sorted by display path. */
  files: ReviewFile[];
  /** The real review data requires Electron filesystem access. */
  desktopOnly: boolean;
  refresh: () => void;
}

/** Shape returned by the `review-list-backups` IPC (electron/main/reviewChanges.ts). */
interface ReviewBackupEntry {
  path: string;
  exists: boolean;
  backups: string[];
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
 * Before/after changes for the session's project. Server-backed copy/worktree
 * projects use their authoritative pending overlays; direct-write projects
 * fall back to WRITE_FILE history and the toolkit's on-disk backups.
 */
export function useReviewChanges(): ReviewChangesState {
  const host = useHost();
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
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
        }))
      ),
    [chatEntries]
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
  const [fetchNonce, setFetchNonce] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setFetchNonce((n) => n + 1);
  }, []);
  const fixtureEnabled = reviewFixtureEnabled();
  const api = host?.electronAPI;
  const desktopOnly = Boolean(
    !fixtureEnabled && (!api?.reviewListBackups || !api?.readFile)
  );

  useEffect(() => {
    if (fixtureEnabled) {
      setFiles(REVIEW_FIXTURE_FILES);
      setLoading(false);
      return;
    }
    if (desktopOnly || !api?.reviewListBackups) {
      setFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const loadFiles = async (): Promise<ReviewFile[]> => {
      if (overlayBacked) {
        if (!spaceId) return [];
        const response = await proxyFetchSpaceProjectOverlays(
          spaceId,
          projectId ?? ''
        );
        const overlays = response.overlays.filter((overlay) =>
          isReviewStatus(overlay.status)
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

        return overlays.map((overlay): ReviewFile => {
          const sourcePath = overlaySourcePath(overlay);
          const entry = sourcePath ? entriesByPath.get(sourcePath) : undefined;
          return {
            id: `overlay:${overlay.run_id}:${overlay.path}`,
            path: overlay.path,
            status: overlay.status as ReviewFileStatus,
            absPath: sourcePath ?? '',
            // The first backup is the run's baseline before any writes. For a
            // pending deletion, an existing source is also valid before-side
            // content when the delete operation did not remove the work copy.
            bakPath:
              entry?.backups[0] ??
              (overlay.status === 'deleted' && entry?.exists && sourcePath
                ? sourcePath
                : null),
          };
        });
      }

      if (changedPaths.length === 0) return [];
      const entries = (await api.reviewListBackups(
        changedPaths
      )) as ReviewBackupEntry[];
      return entries.map((entry): ReviewFile => {
        const status: ReviewFileStatus = entry.exists
          ? entry.backups.length > 0
            ? 'modified'
            : 'added'
          : 'deleted';
        return {
          id: `file:${entry.path.replace(/\\/g, '/')}`,
          path: displayPath(entry.path, spaceRootPath),
          status,
          absPath: entry.path,
          // The earliest backup is the baseline for both modifications and
          // deletions; a later backup is already an intermediate agent write.
          bakPath: entry.backups[0] ?? null,
        };
      });
    };

    loadFiles()
      .then((next) => {
        if (cancelled) return;
        next.sort(
          (a: ReviewFile, b: ReviewFile) =>
            a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
        );
        setFiles(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[ReviewTab] Failed to scan changed files:', error);
        setFiles([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    changedPaths,
    desktopOnly,
    fetchNonce,
    fixtureEnabled,
    overlayBacked,
    projectId,
    spaceId,
    spaceRootPath,
  ]);

  return { loading, files, desktopOnly, refresh };
}
