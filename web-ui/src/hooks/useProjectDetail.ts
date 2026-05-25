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

import { fetchProjectFiles } from '@web/api/brain';
import {
  fetchChatSnapshots,
  fetchChatSteps,
  fetchProjectGroup,
} from '@web/api/server';
import {
  buildSessionSidePanel,
  toWebProject,
  toWebSession,
} from '@web/lib/viewModels';
import type { SessionSidePanelData, WebProject } from '@web/types';
import { useCallback, useEffect, useState } from 'react';

export function useProjectDetail(projectId: string | undefined) {
  const [project, setProject] = useState<WebProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const group = await fetchProjectGroup(projectId);
      if (!group) {
        setProject(null);
        setError('Project not found');
        return;
      }
      setProject(toWebProject(group));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { project, loading, error, reload: load };
}

export function useSessionPanel(
  project: WebProject | null,
  taskId: string | undefined
) {
  const [panel, setPanel] = useState<SessionSidePanelData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!project || !taskId) {
      setPanel(null);
      return;
    }

    const session = project.sessions.find((item) => item.taskId === taskId);
    if (!session) {
      setPanel(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const [steps, snapshots, filesResponse] = await Promise.all([
          fetchChatSteps(taskId).catch(() => []),
          fetchChatSnapshots(taskId).catch(() => []),
          fetchProjectFiles({ projectId: project.projectId, taskId }).catch(
            () => []
          ),
        ]);

        if (cancelled) return;

        const files = Array.isArray(filesResponse)
          ? filesResponse.map(
              (file: {
                filename: string;
                url: string;
                relativePath?: string;
              }) => ({
                filename: file.filename,
                url: file.url,
                relativePath: file.relativePath,
              })
            )
          : [];

        setPanel(
          buildSessionSidePanel({
            session,
            steps,
            snapshots,
            resultFiles: files,
          })
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project, taskId]);

  return { panel, loading };
}

export function createEmptyProject(name: string): WebProject {
  const projectId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `project-${Date.now()}`;
  return {
    projectId,
    name,
    sessionCount: 0,
    totalTokens: 0,
    latestActivity: new Date().toISOString(),
    lastPrompt: '',
    ongoingCount: 0,
    completedCount: 0,
    sessions: [],
  };
}

export { toWebSession };
