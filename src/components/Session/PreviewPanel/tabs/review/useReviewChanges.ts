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
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { REVIEW_FIXTURE_FILES, reviewFixtureEnabled } from './reviewFixture';
import { collectChangedFilePaths } from './reviewSources';

export type ReviewFileStatus = 'added' | 'modified' | 'deleted';

/** One changed file of the current project, ready for the diff view. */
export interface ReviewFile {
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
  refresh: () => void;
}

/** Shape returned by the `review-list-backups` IPC (electron/main/reviewChanges.ts). */
interface ReviewBackupEntry {
  path: string;
  exists: boolean;
  backups: string[];
}

function displayPath(absPath: string, rootPath: string | null): string {
  if (rootPath) {
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (absPath.startsWith(`${normalizedRoot}/`))
      return absPath.slice(normalizedRoot.length + 1);
  }
  return absPath.replace(/^\//, '');
}

/**
 * Before/after changes for the session's project, derived from what agents
 * actually wrote (WRITE_FILE events across every turn). "Before" is the
 * earliest backup the file toolkit left next to the file; "after" is the file
 * on disk right now. Purely observational — this powers a showcase of the
 * changes, not an approval flow.
 */
export function useReviewChanges(): ReviewChangesState {
  const host = useHost();
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const projectStore = useProjectRuntimeStore();
  const spaceRootPath = useSpaceStore((state) => {
    const spaceId =
      (projectId ? state.getProjectMeta(projectId)?.spaceId : null) ??
      state.activeSpaceId;
    return (spaceId ? state.spaces[spaceId]?.rootPath : null) ?? null;
  });

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
    setChangedPaths(computePaths());
    const unsubscribes = chatEntries.map(({ chatStore }) =>
      chatStore.subscribe(() => setChangedPaths(computePaths()))
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chatEntries, computePaths]);

  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchNonce, setFetchNonce] = useState(0);
  const refresh = useCallback(() => setFetchNonce((n) => n + 1), []);

  // Joined so live path updates retrigger without array-identity churn.
  const pathsKey = changedPaths.join('\n');

  useEffect(() => {
    // Checked inside the effect so toggling the flag + Refresh is enough.
    if (reviewFixtureEnabled()) {
      setFiles(REVIEW_FIXTURE_FILES);
      setLoading(false);
      return;
    }
    const api = host?.electronAPI;
    if (!api?.reviewListBackups || changedPaths.length === 0) {
      setFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .reviewListBackups(changedPaths)
      .then((entries: ReviewBackupEntry[]) => {
        if (cancelled) return;
        const next = entries.map((entry): ReviewFile => {
          const status: ReviewFileStatus = entry.exists
            ? entry.backups.length > 0
              ? 'modified'
              : 'added'
            : 'deleted';
          return {
            path: displayPath(entry.path, spaceRootPath),
            status,
            absPath: entry.path,
            // Modified diffs against the oldest backup (the true original);
            // a deletion shows the last content that existed.
            bakPath:
              entry.backups.length === 0
                ? null
                : status === 'deleted'
                  ? entry.backups[entry.backups.length - 1]
                  : entry.backups[0],
          };
        });
        next.sort((a: ReviewFile, b: ReviewFile) =>
          a.path.localeCompare(b.path)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, pathsKey, spaceRootPath, fetchNonce]);

  return { loading, files, refresh };
}
