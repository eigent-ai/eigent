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

import { ArtifactChangeList } from '@/components/ChatBox/MessageItem/ArtifactChangeList';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { cn } from '@/lib/utils';
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
} from '@/lib/workspaceRelativePath';
import {
  fetchRunGitChanges,
  type WorkspaceGitIdentity,
} from '@/service/workspaceGitApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function extension(name: string): string {
  return name.includes('.') ? name.split('.').at(-1) || '' : '';
}

export function normalizeRunReviewPath(
  value: string | undefined
): string | null {
  return normalizeWorkspaceRelativePath(value);
}

function fileInfoFromProjectedArtifact(artifact: ProjectedArtifact): FileInfo {
  const localPathAvailable = artifact.localPathAvailable;
  return {
    name: artifact.name,
    type: extension(artifact.name),
    path: '',
    relativePath: artifact.relativePath,
    artifactId: artifact.artifactId,
    artifactChange: artifact.changeType,
    size: artifact.size ?? undefined,
    modifiedAt: artifact.modifiedAt ?? undefined,
    uploadPolicy:
      artifact.uploadPolicy === 'agent_generated' ||
      artifact.uploadPolicy === 'metadata_only'
        ? artifact.uploadPolicy
        : undefined,
    localPathAvailable,
    assetRef: artifact.assetRef,
    isRemote: !localPathAvailable && Boolean(artifact.assetRef),
  };
}

function fileInfoFromChatArtifact(artifact: ChatArtifactNode): FileInfo {
  const relativePath =
    normalizeRunReviewPath(artifact.relativePath) ??
    normalizeRunReviewPath(artifact.path) ??
    undefined;
  const name =
    artifact.name ||
    relativePath?.split('/').filter(Boolean).at(-1) ||
    artifact.path.split('/').filter(Boolean).at(-1) ||
    artifact.path;
  return {
    name,
    type: extension(name),
    path: '',
    relativePath,
    artifactId: artifact.artifactId,
    artifactChange:
      artifact.operation === 'created'
        ? 'generated'
        : artifact.operation === 'updated'
          ? 'changed'
          : undefined,
    mimeType: artifact.mimeType,
  };
}

function uniqueFiles(files: readonly FileInfo[]): FileInfo[] {
  const byIdentity = new Map<string, FileInfo>();
  for (const file of files) {
    const key = file.artifactId || file.relativePath || file.path || file.name;
    byIdentity.set(key, file);
  }
  return [...byIdentity.values()];
}

export function runFileReviewPath(file: FileInfo): string | null {
  return normalizeRunReviewPath(file.relativePath);
}

export function resolveRunFilePreview(
  file: FileInfo,
  workspaceRoot: string | null | undefined
): FileInfo | null {
  // A projected Artifact may retain its Cloud reference even after the local
  // Project workspace has been restored. Prefer that workspace copy so file
  // previews keep using Electron's bounded local loader (including the rich
  // HTML renderer) instead of a short-lived, CORS-sensitive signed URL.
  const localPath = resolveWorkspaceFilePath(workspaceRoot, file.relativePath);
  if (localPath) {
    return {
      ...file,
      path: localPath,
      localPathAvailable: true,
      isRemote: false,
    };
  }

  const existingPath = file.path?.trim();
  if (existingPath && !file.isRemote) return file;
  if (file.isRemote && (file.assetRef || /^https?:\/\//i.test(existingPath))) {
    return file;
  }
  return null;
}

export interface RunFileSources {
  artifactNodes?: readonly ChatArtifactNode[];
  projectedArtifacts?: readonly ProjectedArtifact[];
}

export interface RunFilesProps extends RunFileSources {
  runId: string;
  projectId?: string;
}

interface RunFileDiffStats {
  totals: { added: number; removed: number };
  byPath: Map<string, { added: number; removed: number }>;
}

/**
 * A finished Run's line counts never change. Resolved stats are memoised and
 * in-flight requests shared, keyed by the Run and the space that owns it.
 * `RunFilesGroup` activates the request only when its card approaches view, so
 * mounting a long, unwindowed narrative does not fetch every Run at once.
 */
const runDiffStatsCache = new Map<string, Promise<RunFileDiffStats | null>>();

const RUN_DIFF_STATS_PREFETCH_MARGIN = '240px 0px';

function useRunFileDiffStatsActivation(hasFiles: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (active || !hasFiles) return;
    // The wrapper uses `display: contents` to avoid changing layout, so observe
    // the ArtifactChangeList section that supplies the actual box instead.
    const target = rootRef.current?.firstElementChild;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      {
        rootMargin: RUN_DIFF_STATS_PREFETCH_MARGIN,
        threshold: 0,
      }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, hasFiles]);

  return { active, rootRef };
}

function loadRunFileDiffStats(
  runId: string,
  spaceId: string,
  identity: WorkspaceGitIdentity
): Promise<RunFileDiffStats | null> {
  const key = `${spaceId}:${runId}`;
  const cached = runDiffStatsCache.get(key);
  if (cached) return cached;
  const request = fetchRunGitChanges(runId, spaceId, identity)
    .then((response) => {
      if ('available' in response) return null;
      const byPath = new Map<string, { added: number; removed: number }>();
      for (const file of response.files) {
        const path = normalizeRunReviewPath(file.path);
        if (!path || file.added_lines === null || file.removed_lines === null) {
          continue;
        }
        byPath.set(path, {
          added: file.added_lines,
          removed: file.removed_lines,
        });
      }
      return { totals: response.totals, byPath };
    })
    .catch(() => {
      // Only successes are worth remembering; a transient failure should not
      // pin this Run to "no stats" for the rest of the session.
      runDiffStatsCache.delete(key);
      return null;
    });
  runDiffStatsCache.set(key, request);
  return request;
}

/** Test seam: the cache outlives a render tree, so suites must reset it. */
export function resetRunFileDiffStatsCache(): void {
  runDiffStatsCache.clear();
}

export function useRunFileDiffStats(
  runId: string,
  projectId?: string,
  active = true
): RunFileDiffStats | null {
  const previewProjectId = usePageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const resolvedProjectId = projectId ?? previewProjectId;
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const spaceId = useSpaceStore((state) =>
    resolvedProjectId
      ? (state.getProjectMeta(resolvedProjectId)?.spaceId ?? null)
      : null
  );
  const [stats, setStats] = useState<RunFileDiffStats | null>(null);

  useEffect(() => {
    setStats(null);
    // Legacy spaces have no Git repository behind them, so the request can only
    // fail — the same guard `useReviewChanges` applies before going to Git.
    if (
      !active ||
      !runId ||
      !spaceId ||
      !email ||
      spaceId.startsWith('legacy_')
    )
      return;

    let cancelled = false;
    void loadRunFileDiffStats(runId, spaceId, { email, userId }).then(
      (next) => {
        if (!cancelled) setStats(next);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [active, email, runId, spaceId, userId]);

  return stats;
}

export function useRunFileInfo({
  artifactNodes = [],
  projectedArtifacts = [],
}: RunFileSources): FileInfo[] {
  return useMemo(
    () =>
      uniqueFiles(
        projectedArtifacts.length > 0
          ? projectedArtifacts.map(fileInfoFromProjectedArtifact)
          : artifactNodes
              .filter((artifact) => artifact.operation !== 'deleted')
              .map(fileInfoFromChatArtifact)
      ),
    [artifactNodes, projectedArtifacts]
  );
}

export function RunFilesGroup(props: RunFilesProps) {
  const files = useRunFileInfo(props);
  const { active: loadDiffStats, rootRef } = useRunFileDiffStatsActivation(
    files.length > 0
  );
  const previewProjectId = usePageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const projectId = props.projectId ?? previewProjectId;
  const workspaceRoot = useSpaceStore((state) => {
    const spaceId = projectId ? state.getProjectMeta(projectId)?.spaceId : null;
    return spaceId ? state.spaces[spaceId]?.rootPath : null;
  });
  const openFilePreview = usePageTabStore((state) => state.openFilePreview);
  const openReviewPreview = usePageTabStore((state) => state.openReviewPreview);
  const diffStats = useRunFileDiffStats(
    props.runId,
    projectId ?? undefined,
    loadDiffStats
  );
  const lineChangesForFile = useCallback(
    (file: FileInfo) => {
      const path = runFileReviewPath(file);
      return path ? (diffStats?.byPath.get(path) ?? null) : null;
    },
    [diffStats]
  );
  // Sum the rows on screen rather than reusing the Run's Git totals: the list
  // is built from artifacts, so a Git total would describe a different file
  // set than the "Edited N files" count sitting beside it.
  const totals = useMemo(() => {
    if (!diffStats) return null;
    let added = 0;
    let removed = 0;
    let matched = false;
    for (const file of files) {
      const path = runFileReviewPath(file);
      const stats = path ? diffStats.byPath.get(path) : undefined;
      if (!stats) continue;
      matched = true;
      added += stats.added;
      removed += stats.removed;
    }
    return matched ? { added, removed } : null;
  }, [diffStats, files]);

  return (
    <div ref={rootRef} className="contents" data-run-files-group={props.runId}>
      <ArtifactChangeList
        files={files}
        totals={totals}
        lineChangesForFile={lineChangesForFile}
        onViewChanges={() => openReviewPreview({ runId: props.runId })}
        onOpen={(file) => {
          const preview = resolveRunFilePreview(file, workspaceRoot);
          if (preview) openFilePreview(preview);
        }}
        canOpenFile={(file) =>
          resolveRunFilePreview(file, workspaceRoot) !== null
        }
      />
    </div>
  );
}

export function FilesChangedSummaryRow({
  embedded = false,
  ...props
}: RunFileSources & { embedded?: boolean }) {
  const { t } = useTranslation();
  const files = useRunFileInfo(props);

  return (
    <div
      className={cn(
        'flex min-h-10 w-full items-center gap-2 px-3 py-2',
        embedded
          ? 'border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default bg-transparent'
          : 'rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default'
      )}
      data-files-changed-summary
    >
      <FileText
        aria-hidden
        className="size-4 shrink-0 text-ds-ink-subtle-default"
      />
      <span className="min-w-0 flex-1 text-ds-text-base font-normal text-ds-ink-default-default">
        {t('chat.files-changed')}
      </span>
      <span className="shrink-0 text-ds-text-base font-medium text-ds-text-success-default-default tabular-nums">
        {files.length}
      </span>
    </div>
  );
}
