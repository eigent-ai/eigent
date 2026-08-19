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
import { useAuthStore } from '@/store/authStore';
import { ChatTaskStatus } from '@/types/constants';
import { useEffect, useState } from 'react';
import { getSidePanelOutputFilesRevision } from './collectSidePanelOutputFiles';

type SidePanelTask = {
  status?: string;
  taskAssigning?: Agent[];
};

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
      file.isRemote === other?.isRemote
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
  const [files, setFiles] = useState<FileInfo[]>([]);
  const outputFilesRevision = getSidePanelOutputFilesRevision(activeTask);
  const taskFinished = activeTask?.status === ChatTaskStatus.FINISHED;
  const workspaceRelativePathsKey = workspaceRelativePaths.join('\0');

  useEffect(() => {
    let cancelled = false;

    const loadFiles = async () => {
      if (!projectId || !email) {
        if (!cancelled) setFiles([]);
        return;
      }

      let nextFiles: FileInfo[] = [];
      let localLookupSucceeded = false;
      const ipcRenderer = host?.ipcRenderer;

      if (ipcRenderer?.invoke) {
        if (workspaceRoot) {
          try {
            // Keep registration and enumeration ordered so switching between
            // Spaces cannot race Layout's root-registration effect.
            await ipcRenderer.invoke('set-local-file-preview-roots', [
              workspaceRoot,
            ]);
            const workspaceFiles = await ipcRenderer.invoke(
              'get-workspace-file-list',
              workspaceRoot,
              workspaceRelativePathsKey
                ? workspaceRelativePathsKey.split('\0')
                : []
            );
            if (Array.isArray(workspaceFiles)) {
              localLookupSucceeded = true;
              nextFiles = workspaceFiles;
            }
          } catch (error) {
            console.warn(
              '[SidePanel] Failed to resolve Space workspace files:',
              error
            );
          }
        }

        // Compatibility fallback for Projects that still use the legacy
        // ~/eigent/<identity>/project_<id> storage layout.
        if (!localLookupSucceeded) {
          try {
            const localFiles = await ipcRenderer.invoke(
              'get-project-file-list',
              email,
              projectId,
              userId
            );
            if (Array.isArray(localFiles)) {
              localLookupSucceeded = true;
              nextFiles = localFiles;
            }
          } catch (error) {
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
      if (!localLookupSucceeded) {
        try {
          const baseURL = await getBaseURL();
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
        setFiles((current) =>
          sameFileList(current, visibleFiles) ? current : visibleFiles
        );
      }
    };

    void loadFiles();

    return () => {
      cancelled = true;
    };
  }, [
    email,
    host?.ipcRenderer,
    outputFilesRevision,
    projectId,
    taskFinished,
    taskId,
    userId,
    workspaceRelativePathsKey,
    workspaceRoot,
  ]);

  return files;
}
