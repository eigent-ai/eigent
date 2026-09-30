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
// Licensed under the Apache License, Version 2.0 (the "License");

import { fetchGet } from '@/api/http';
import { useHost } from '@/host';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { normalizeWorkspaceRelativePath } from '@/lib/workspaceRelativePath';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useMemo, useState } from 'react';

export interface AnnotationReferenceFile {
  projectId: string;
  projectName: string;
  name: string;
  relativePath: string;
}

type Scope = 'session' | 'space';
type FileSnapshot = {
  key: string;
  files: AnnotationReferenceFile[];
  loading: boolean;
  error: boolean;
};

function normalizeFiles(
  items: unknown,
  projectId: string,
  projectName: string
): AnnotationReferenceFile[] {
  if (!Array.isArray(items)) return [];
  const files = items.flatMap((item): FileInfo[] => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const name = source.name ?? source.filename;
    if (typeof name !== 'string' || !name.trim()) return [];
    const relativePath = source.relativePath ?? source.relative_path ?? name;
    if (typeof relativePath !== 'string') return [];
    return [
      {
        name,
        relativePath,
        path: typeof source.path === 'string' ? source.path : relativePath,
        type: name.split('.').pop() ?? '',
        isFolder: source.isFolder === true,
      },
    ];
  });
  return filterVisibleAgentFiles(files)
    .filter((file) => !file.isFolder)
    .flatMap((file) => {
      const relativePath = normalizeWorkspaceRelativePath(
        file.relativePath || file.name
      );
      return relativePath
        ? [{ projectId, projectName, name: file.name, relativePath }]
        : [];
    });
}

/** The same project/Space file boundaries used by the Files view. */
export function useAnnotationReferenceFiles(
  spaceId: string | null,
  projectId: string | null,
  scope: Scope,
  enabled: boolean
) {
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const space = useSpaceStore((state) =>
    spaceId ? state.spaces[spaceId] : null
  );
  const projectMap = useSpaceStore((state) =>
    spaceId ? state.projectsBySpaceId[spaceId] : undefined
  );
  const ipcRenderer = useHost()?.ipcRenderer;
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<FileSnapshot | null>(null);

  const targets = useMemo(() => {
    const projects = Object.values(projectMap ?? {})
      .filter((project) => project.id && project.status !== 'archived')
      .map((project) => ({ id: project.id, name: project.name || project.id }));
    if (scope === 'space') {
      if (projectId && !projects.some((project) => project.id === projectId)) {
        projects.push({ id: projectId, name: projectId });
      }
      return projects;
    }
    if (!projectId) return [];
    return [
      projects.find((project) => project.id === projectId) ?? {
        id: projectId,
        name: projectId,
      },
    ];
  }, [projectId, projectMap, scope]);
  const targetsKey = JSON.stringify(targets);
  const requestKey = JSON.stringify([
    spaceId,
    projectId,
    scope,
    email,
    userId,
    targetsKey,
    revision,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!spaceId || !email || targets.length === 0) {
      setSnapshot({ key: requestKey, files: [], loading: false, error: false });
      return;
    }
    let cancelled = false;
    setSnapshot({ key: requestKey, files: [], loading: true, error: false });
    const loadTarget = async (target: { id: string; name: string }) => {
      let localFiles: unknown = null;
      if (
        ipcRenderer?.invoke &&
        isLocalWorkspaceSpace(space) &&
        !space?.rootPath
      ) {
        try {
          localFiles = await ipcRenderer.invoke(
            'get-project-file-list',
            email,
            target.id,
            userId
          );
        } catch {
          // The Files view falls back to Brain for older or unavailable local lists.
        }
      }
      if (Array.isArray(localFiles) && localFiles.length > 0) {
        return normalizeFiles(localFiles, target.id, target.name);
      }
      try {
        const remoteFiles = await fetchGet('/files', {
          project_id: target.id,
          email,
          space_id: spaceId,
          ...(userId != null ? { user_id: String(userId) } : {}),
        });
        if (Array.isArray(remoteFiles)) {
          return normalizeFiles(remoteFiles, target.id, target.name);
        }
      } catch {
        if (Array.isArray(localFiles)) {
          return normalizeFiles(localFiles, target.id, target.name);
        }
        if (ipcRenderer?.invoke) {
          const fallback = await ipcRenderer.invoke(
            'get-project-file-list',
            email,
            target.id,
            userId
          );
          if (Array.isArray(fallback)) {
            return normalizeFiles(fallback, target.id, target.name);
          }
        }
      }
      throw new Error('File list unavailable');
    };
    void Promise.allSettled(targets.map(loadTarget)).then((results) => {
      if (cancelled) return;
      const files = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : []
      );
      const unique = new Map(
        files.map((file) => [`${file.projectId}\0${file.relativePath}`, file])
      );
      setSnapshot({
        key: requestKey,
        files: [...unique.values()].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        ),
        loading: false,
        error: results.every((result) => result.status === 'rejected'),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    email,
    enabled,
    ipcRenderer,
    requestKey,
    space,
    spaceId,
    targets,
    userId,
  ]);

  return {
    files: snapshot?.key === requestKey ? snapshot.files : [],
    loading: enabled && (snapshot?.key !== requestKey || snapshot.loading),
    error: snapshot?.key === requestKey && snapshot.error,
    refresh: () => setRevision((current) => current + 1),
  };
}
