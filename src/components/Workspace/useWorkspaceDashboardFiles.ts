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
import { loadFilePreview } from '@/lib/filePreviewLoader';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore, type SpaceProjectMeta } from '@/store/spaceStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getWorkspaceDashboardFileId,
  isWorkspaceDashboardMarkdownFile,
} from './workspaceDashboardModel';

function projectLabel(project: SpaceProjectMeta): string {
  const name = project.name?.trim();
  return (name || project.id).replace(/[\\/]/g, '-');
}

function sameMarkdownFiles(left: FileInfo[], right: FileInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const other = right[index];
    return (
      getWorkspaceDashboardFileId(file) ===
        (other ? getWorkspaceDashboardFileId(other) : '') &&
      file.path === other?.path &&
      file.modifiedAt === other?.modifiedAt &&
      file.size === other?.size
    );
  });
}

function normalizeRemoteMarkdownFiles(
  items: unknown[],
  project: SpaceProjectMeta,
  baseURL: string
): FileInfo[] {
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const filename =
        typeof record.filename === 'string' ? record.filename : '';
      const rawUrl = typeof record.url === 'string' ? record.url : '';
      const relativePathValue =
        typeof record.relativePath === 'string'
          ? record.relativePath
          : typeof record.relative_path === 'string'
            ? record.relative_path
            : filename;
      const file: FileInfo = {
        name: filename,
        type: filename.split('.').pop()?.toLowerCase() || '',
        path: rawUrl.startsWith('http') ? rawUrl : `${baseURL}${rawUrl}`,
        relativePath: `${projectLabel(project)}/${relativePathValue}`,
        project_id: project.id,
        isRemote: true,
        size:
          typeof record.size === 'number' && record.size >= 0
            ? record.size
            : undefined,
        modifiedAt:
          typeof record.modifiedAt === 'number' ? record.modifiedAt : undefined,
        supportsRanges: record.supportsRanges === true,
      };
      return isWorkspaceDashboardMarkdownFile(file) ? file : null;
    })
    .filter((file): file is FileInfo => Boolean(file));
}

export function useWorkspaceDashboardFiles() {
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeSpace = useSpaceStore((state) =>
    state.activeSpaceId ? state.spaces[state.activeSpaceId] : null
  );
  const activeSpaceAvailable = Boolean(activeSpace);
  const activeSpaceRootPath = activeSpace?.rootPath ?? null;
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const projects = useMemo(() => {
    if (!activeSpaceId) return [];
    return Object.values(projectsBySpaceId[activeSpaceId] ?? {})
      .filter((project) => project.status !== 'archived')
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [activeSpaceId, projectsBySpaceId]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      if (!activeSpaceId || !activeSpaceAvailable) {
        setFiles([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        let nextFiles: FileInfo[] = [];
        if (activeSpaceRootPath && host?.ipcRenderer?.invoke) {
          await host.ipcRenderer.invoke('set-local-file-preview-roots', [
            activeSpaceRootPath,
          ]);
          const result = await host.ipcRenderer.invoke(
            'get-workspace-markdown-file-list',
            activeSpaceRootPath
          );
          if (Array.isArray(result)) {
            nextFiles = result.filter(isWorkspaceDashboardMarkdownFile);
          }
        } else if (email && projects.length > 0) {
          const baseURL = await getBaseURL();
          if (!baseURL) throw new Error('Brain is not connected');
          const lists = await Promise.all(
            projects.map(async (project) => {
              const result = await fetchGet(
                '/files',
                {
                  project_id: project.id,
                  email,
                  space_id: activeSpaceId,
                  ...(userId != null ? { user_id: String(userId) } : {}),
                },
                undefined,
                { signal: controller.signal }
              );
              return Array.isArray(result)
                ? normalizeRemoteMarkdownFiles(result, project, baseURL)
                : [];
            })
          );
          nextFiles = lists.flat();
        }

        if (cancelled) return;
        nextFiles.sort((left, right) =>
          (left.relativePath || left.name).localeCompare(
            right.relativePath || right.name
          )
        );
        setFiles((current) =>
          sameMarkdownFiles(current, nextFiles) ? current : nextFiles
        );
      } catch (loadError) {
        if (cancelled || controller.signal.aborted) return;
        console.warn(
          '[WorkspaceDashboard] Failed to load Markdown files:',
          loadError
        );
        setFiles([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load files'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeSpaceAvailable,
    activeSpaceId,
    activeSpaceRootPath,
    email,
    host,
    projects,
    revision,
    userId,
  ]);

  const loadContent = useCallback(
    (file: FileInfo, signal?: AbortSignal) =>
      loadFilePreview(file, {
        ipcRenderer: host?.ipcRenderer,
        signal,
      }),
    [host]
  );

  return {
    activeSpace,
    files,
    loading,
    error,
    refresh,
    loadContent,
  };
}
