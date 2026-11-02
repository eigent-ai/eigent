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
import { DURABLE_RUN_STATUS_CHANGED_EVENT } from '@/lib/events/durableRunEvents';
import type { SessionNavLeadKind } from '@/lib/sessionNavLead';
import {
  fetchRunAttention,
  type ProjectRunAttention,
  type RunAttentionState,
} from '@/service/projectRunsApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useMemo, useState } from 'react';

export const SPACE_ATTENTION_POLL_MS = 5_000;

export interface SpaceAttention {
  running: number;
  waiting: number;
}

/** Sessions the renderer has loaded report their state before the next poll. */
export function liveRunAttentionState(
  kind: SessionNavLeadKind | undefined
): RunAttentionState | null {
  switch (kind) {
    case 'hitl':
    case 'blocked':
      return 'waiting';
    case 'running':
    case 'splitting':
      return 'running';
    default:
      return null;
  }
}

/**
 * Count each Session once per Space, at its strongest state: waiting outranks
 * running, whichever source reports it. A Session the index no longer knows
 * (deleted, or another account's) is skipped.
 */
export function mergeSpaceAttention({
  brain,
  liveKinds,
  projectIdIndex,
}: {
  brain: readonly ProjectRunAttention[];
  liveKinds: Readonly<Record<string, SessionNavLeadKind | undefined>>;
  projectIdIndex: Readonly<Record<string, string>>;
}): Record<string, SpaceAttention> {
  const stateByProject = new Map<string, RunAttentionState>();
  const raise = (projectId: string, state: RunAttentionState | null) => {
    if (!state) return;
    if (stateByProject.get(projectId) !== 'waiting') {
      stateByProject.set(projectId, state);
    }
  };
  for (const row of brain) raise(row.projectId, row.state);
  for (const [projectId, kind] of Object.entries(liveKinds)) {
    raise(projectId, liveRunAttentionState(kind));
  }

  const bySpace: Record<string, SpaceAttention> = {};
  for (const [projectId, state] of stateByProject) {
    const spaceId = projectIdIndex[projectId];
    if (!spaceId) continue;
    const entry = (bySpace[spaceId] ??= { running: 0, waiting: 0 });
    entry[state] += 1;
  }
  return bySpace;
}

const windowIsAttended = () =>
  typeof document === 'undefined' ||
  (document.visibilityState === 'visible' && document.hasFocus());

/**
 * Running and waiting Sessions per Space, for status marks on Spaces that
 * aren't loaded. Polls the Brain every 5s while the window is focused, stops
 * while it's hidden or in the background, and keeps the last answer when a
 * read fails.
 */
export function useSpaceAttention(): Record<string, SpaceAttention> {
  const ipcRenderer = useHost()?.ipcRenderer;
  const [brain, setBrain] = useState<ProjectRunAttention[]>([]);
  const projectIdIndex = useSpaceStore((state) => state.projectIdIndex);
  const navLeadByProjectId = useProjectRuntimeStore(
    (state) => state.navLeadByProjectId
  );

  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (lifetime.signal.aborted || !windowIsAttended()) return;
      timer = setTimeout(() => void poll(), SPACE_ATTENTION_POLL_MS);
    };
    const poll = async () => {
      if (inFlight || lifetime.signal.aborted) return;
      inFlight = true;
      try {
        const rows = await fetchRunAttention(lifetime.signal);
        if (!lifetime.signal.aborted) setBrain(rows);
      } catch {
        // The Brain may be starting or restarting; keep the last answer.
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const resume = () => {
      if (windowIsAttended()) void poll();
      else schedule();
    };

    void poll();
    window.addEventListener('focus', resume);
    window.addEventListener('blur', schedule);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener(DURABLE_RUN_STATUS_CHANGED_EVENT, resume);
    ipcRenderer?.on('backend-ready', resume);
    return () => {
      lifetime.abort();
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('blur', schedule);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener(DURABLE_RUN_STATUS_CHANGED_EVENT, resume);
      ipcRenderer?.off('backend-ready', resume);
    };
  }, [ipcRenderer]);

  return useMemo(() => {
    const liveKinds: Record<string, SessionNavLeadKind | undefined> = {};
    for (const [projectId, lead] of Object.entries(navLeadByProjectId)) {
      liveKinds[projectId] = lead?.kind;
    }
    return mergeSpaceAttention({ brain, liveKinds, projectIdIndex });
  }, [brain, navLeadByProjectId, projectIdIndex]);
}
