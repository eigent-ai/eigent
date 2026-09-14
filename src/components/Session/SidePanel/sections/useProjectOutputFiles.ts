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

import { fetchGet, getBaseURL } from '@/api/http';
import { useHost } from '@/host';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import { normalizeWorkspaceRelativePath } from '@/lib/workspaceRelativePath';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { ChatTaskStatus } from '@/types/constants';
import { useEffect, useState } from 'react';
import { getSidePanelOutputFilesRevision } from './collectSidePanelOutputFiles';

type SidePanelTask = {
  status?: string;
  taskAssigning?: Agent[];
};

const EMPTY_FILES: FileInfo[] = [];

function mergeWorkspaceFileBatch(
  files: Map<string, FileInfo>,
  batch: unknown,
  requestedPaths: string[]
): void {
  if (
    !Array.isArray(batch) ||
    batch.length > FILE_PREVIEW_LIMITS.workspaceResolverPaths
  ) {
    throw new Error('Invalid workspace file resolver batch');
  }
  const requested = new Set(requestedPaths.map(normalizeWorkspaceRelativePath));
  for (const file of batch) {
    if (
      !file ||
      typeof file.relativePath !== 'string' ||
      typeof file.path !== 'string' ||
      typeof file.name !== 'string' ||
      typeof file.type !== 'string' ||
      file.isRemote ||
      file.isFolder ||
      file.path.includes('\0') ||
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(file.path)
    ) {
      throw new Error('Invalid workspace file resolver entry');
    }
    const relativePath = normalizeWorkspaceRelativePath(file.relativePath);
    if (!relativePath || !requested.has(relativePath)) {
      throw new Error('Unrequested workspace file resolver identity');
    }
    // Absolute paths are supplied by the main-process realpath/authorization
    // boundary. Never derive one from a basename or substitute another asset.
    const existing = files.get(relativePath);
    if (existing && !sameFileList([existing], [file])) {
      throw new Error('Conflicting workspace file resolver identity');
    }
    files.set(relativePath, file);
  }
}

function normalizeRemoteFiles(items: any[], baseURL: string): FileInfo[] {
  return items.map((item: any) => {
    const filename = item.filename || '';
    const relativePath = item.relative_path || item.relativePath;
    const artifactId = item.artifact_id || item.artifactId;
    const url = item.url?.startsWith('http')
      ? item.url
      : `${baseURL}${item.url || ''}`;
    return {
      name: filename,
      type: filename.split('.').pop() || '',
      path: url,
      relativePath:
        typeof relativePath === 'string' && relativePath.trim()
          ? relativePath
          : undefined,
      artifactId:
        typeof artifactId === 'string' && artifactId.trim()
          ? artifactId
          : undefined,
      isRemote: true,
    };
  });
}

function sameFileList(left: FileInfo[], right: FileInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const other = right[index];
    return (
      file.path === other?.path &&
      file.relativePath === other?.relativePath &&
      file.artifactId === other?.artifactId &&
      file.name === other?.name &&
      file.type === other?.type &&
      file.isRemote === other?.isRemote &&
      file.size === other?.size &&
      file.modifiedAt === other?.modifiedAt &&
      file.mimeType === other?.mimeType
    );
  });
}

/** Loads generated output files for the SidePanel Files section. */
export function useProjectOutputFiles(
  projectId: string | null | undefined,
  activeTask: SidePanelTask | undefined,
  /** Optional task ID — when it changes, triggers an immediate re-fetch. */
  taskId?: string | null,
  /** Authoritative root of the Space that owns this Project. */
  workspaceRoot?: string | null,
  /** Durable workspace-relative artifact identities to resolve. */
  workspaceRelativePaths: readonly string[] = []
): FileInfo[] {
  const host = useHost();
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const ipcRenderer = host?.ipcRenderer;
  const [resolved, setResolved] = useState<{
    requestKey: string;
    ipcRenderer: typeof ipcRenderer;
    files: FileInfo[];
  } | null>(null);
  const outputFilesRevision = getSidePanelOutputFilesRevision(activeTask);
  const taskFinished = activeTask?.status === ChatTaskStatus.FINISHED;
  // JSON preserves path boundaries, including invalid embedded NULs. A NUL
  // delimiter would silently turn one invalid identity into two valid ones.
  const workspaceRelativePathsKey = JSON.stringify([
    ...new Set(workspaceRelativePaths),
  ]);
  const requestKey = JSON.stringify([
    email,
    userId,
    projectId,
    taskId,
    workspaceRoot,
    workspaceRelativePathsKey,
    outputFilesRevision,
    taskFinished,
  ]);

  useEffect(() => {
    let cancelled = false;
    // Discard the previous snapshot even if this request never finishes.
    // Otherwise A -> B (pending) -> A could revive A's old result by key.
    setResolved(null);

    const loadFiles = async () => {
      if (!projectId || !email) {
        if (!cancelled) setResolved(null);
        return;
      }

      let nextFiles: FileInfo[] = [];
      let localLookupSucceeded = false;
      const usesWorkspaceResolver = Boolean(
        workspaceRoot && ipcRenderer?.invoke
      );

      if (ipcRenderer?.invoke) {
        if (workspaceRoot) {
          try {
            const paths: string[] = JSON.parse(workspaceRelativePathsKey);
            if (paths.some((path) => !normalizeWorkspaceRelativePath(path))) {
              throw new Error('Invalid workspace-relative file identity');
            }
            // Keep registration and enumeration ordered so switching between
            // Spaces does not issue new lookups from a cancelled request.
            // Main still authorizes every batch against the current root set.
            const registration = await ipcRenderer.invoke(
              'set-local-file-preview-roots',
              [workspaceRoot]
            );
            if (cancelled) return;
            if (registration?.success !== true || registration.roots !== 1) {
              throw new Error('Workspace preview root registration failed');
            }
            const workspaceFiles = new Map<string, FileInfo>();
            for (
              let index = 0;
              index < paths.length;
              index += FILE_PREVIEW_LIMITS.workspaceResolverPaths
            ) {
              const requested = paths.slice(
                index,
                index + FILE_PREVIEW_LIMITS.workspaceResolverPaths
              );
              const batch: unknown = await ipcRenderer.invoke(
                'get-workspace-file-list',
                workspaceRoot,
                requested
              );
              if (cancelled) return;
              mergeWorkspaceFileBatch(workspaceFiles, batch, requested);
            }
            // Publish once, after every batch has passed. An empty manifest
            // must not cause a filesystem scan or invent durable file rows.
            nextFiles = [...workspaceFiles.values()].sort((left, right) =>
              left.path.localeCompare(right.path)
            );
            localLookupSucceeded = true;
          } catch (error) {
            if (cancelled) return;
            console.warn(
              '[SidePanel] Failed to resolve Space workspace files:',
              error
            );
          }
        }

        // Compatibility only for Projects without an owning workspace root.
        // Workspace failures must not escape into legacy or HTTP resolution.
        if (!workspaceRoot) {
          try {
            const localFiles = await ipcRenderer.invoke(
              'get-project-file-list',
              email,
              projectId,
              userId
            );
            if (cancelled) return;
            if (Array.isArray(localFiles)) {
              localLookupSucceeded = true;
              nextFiles = localFiles;
            }
          } catch (error) {
            if (cancelled) return;
            console.warn(
              '[SidePanel] Failed to fetch local project files:',
              error
            );
          }
        }
      }

      // Electron already has the authoritative local file list. Local-proxy
      // mode only changes where Brain HTTP points; it must not force a second,
      // identical /files request after IPC succeeded.
      if (!localLookupSucceeded && !usesWorkspaceResolver) {
        try {
          const baseURL = await getBaseURL();
          if (cancelled) return;
          if (baseURL) {
            const listRes = await fetchGet('/files', {
              project_id: projectId,
              email,
              ...(userId != null ? { user_id: String(userId) } : {}),
            });
            if (Array.isArray(listRes)) {
              nextFiles = normalizeRemoteFiles(listRes, baseURL);
            }
          }
        } catch (error) {
          console.warn(
            '[SidePanel] Failed to fetch remote project files:',
            error
          );
        }
      }

      if (!cancelled) {
        const visibleFiles = filterVisibleAgentFiles(nextFiles);
        setResolved((current) =>
          current?.requestKey === requestKey &&
          current.ipcRenderer === ipcRenderer &&
          sameFileList(current.files, visibleFiles)
            ? current
            : { requestKey, ipcRenderer, files: visibleFiles }
        );
      }
    };

    void loadFiles();

    return () => {
      cancelled = true;
    };
  }, [
    email,
    ipcRenderer,
    outputFilesRevision,
    projectId,
    requestKey,
    taskFinished,
    taskId,
    userId,
    workspaceRelativePathsKey,
    workspaceRoot,
  ]);

  // Do not expose the previous Space/Session/scope snapshot even for the
  // render before the next effect starts. Late responses cannot republish it.
  return resolved?.requestKey === requestKey &&
    resolved.ipcRenderer === ipcRenderer
    ? resolved.files
    : EMPTY_FILES;
}
