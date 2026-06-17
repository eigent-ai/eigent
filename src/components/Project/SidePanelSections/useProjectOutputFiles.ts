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
import { useEffect, useMemo, useState } from 'react';

type SidePanelTask = {
  status?: string;
  taskAssigning?: Agent[];
};

function isTaskLive(task: SidePanelTask | undefined): boolean {
  if (!task) return false;
  if (
    task.status === ChatTaskStatus.RUNNING ||
    task.status === ChatTaskStatus.PENDING
  ) {
    return true;
  }
  return (task.taskAssigning ?? []).some(
    (agent) => agent.status === 'running' || agent.status === 'pending'
  );
}

function normalizeRemoteFiles(items: any[], baseURL: string): FileInfo[] {
  return items.map((item: any) => {
    const filename = item.filename || '';
    const url = item.url?.startsWith('http')
      ? item.url
      : `${baseURL}${item.url || ''}`;
    return {
      name: filename,
      type: filename.split('.').pop() || '',
      path: url,
      relativePath: item.relativePath || filename,
      isRemote: true,
    };
  });
}

export function useProjectOutputFiles(
  projectId: string | null | undefined,
  activeTask: SidePanelTask | undefined,
  /** Optional task ID — when it changes, triggers an immediate re-fetch. */
  taskId?: string | null
): FileInfo[] {
  const host = useHost();
  const email = useAuthStore((s) => s.email);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const live = useMemo(() => isTaskLive(activeTask), [activeTask]);

  useEffect(() => {
    let cancelled = false;

    const loadFiles = async () => {
      if (!projectId || !email) {
        if (!cancelled) setFiles([]);
        return;
      }

      let nextFiles: FileInfo[] = [];
      const ipcRenderer = host?.ipcRenderer;

      if (ipcRenderer?.invoke) {
        try {
          const localFiles = await ipcRenderer.invoke(
            'get-project-file-list',
            email,
            projectId
          );
          if (Array.isArray(localFiles)) {
            nextFiles = localFiles;
          }
        } catch (error) {
          console.warn(
            '[SidePanel] Failed to fetch local project files:',
            error
          );
        }
      }

      if (
        !nextFiles.length ||
        !ipcRenderer?.invoke ||
        import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
      ) {
        try {
          const baseURL = await getBaseURL();
          if (baseURL) {
            const listRes = await fetchGet('/files', {
              project_id: projectId,
              email,
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

      if (!cancelled) setFiles(filterVisibleAgentFiles(nextFiles));
    };

    void loadFiles();

    if (!live) {
      // One deferred fetch 5 s after the task finishes to catch async writes
      // (summaries, JSON outputs) that flush after the FINISHED status event.
      const deferred = setTimeout(() => void loadFiles(), 5000);
      return () => {
        cancelled = true;
        clearTimeout(deferred);
      };
    }

    const timer = setInterval(() => {
      void loadFiles();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [email, host?.ipcRenderer, live, projectId, taskId]);

  return files;
}
