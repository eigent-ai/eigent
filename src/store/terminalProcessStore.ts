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

import { fetchGet, fetchPost } from '@/api/http';
import { create } from 'zustand';

export interface TerminalProcess {
  id: string;
  project_id: string;
  run_id: string;
  tool_call_id?: string;
  session_id: string;
  agent_name: string;
  label: string;
  status:
    'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'unavailable';
  can_stop: boolean;
  output: string;
  offset: number;
  version: number;
  url: string | null;
  stop_error: string | null;
  exit_code: number | null;
}
interface State {
  projects: Record<string, TerminalProcess[]>;
  refresh: (projectId: string) => Promise<void>;
  stop: (projectId: string, id: string) => Promise<void>;
}
const fetching = new Set<string>();
const generations = new Map<string, number>();
function sameProcess(left: TerminalProcess, right: TerminalProcess) {
  const keys = Object.keys(right) as (keyof TerminalProcess)[];
  return (
    keys.length === Object.keys(left).length &&
    keys.every((key) => left[key] === right[key])
  );
}

function reconcileProcesses(
  previous: TerminalProcess[],
  incoming: TerminalProcess[]
) {
  const previousById = new Map(
    previous.map((process) => [process.id, process])
  );
  const next = incoming.map((process) => {
    const old = previousById.get(process.id);
    const candidate = {
      ...process,
      output: process.output ?? old?.output ?? '',
    };
    return old && sameProcess(old, candidate) ? old : candidate;
  });
  for (const process of previous) {
    if (incoming.some((candidate) => candidate.id === process.id)) continue;
    const unavailable = {
      ...process,
      status: 'unavailable' as const,
      can_stop: false,
    };
    next.push(sameProcess(process, unavailable) ? process : unavailable);
  }
  return next.slice(0, incoming.length + 100);
}

export const useTerminalProcessStore = create<State>((set, get) => ({
  projects: {},
  async refresh(projectId) {
    if (fetching.has(projectId)) return;
    fetching.add(projectId);
    const generation = generations.get(projectId) ?? 0;
    const previous = get().projects[projectId] ?? [];
    const versions = Object.fromEntries(previous.map((p) => [p.id, p.version]));
    try {
      const response: { processes: TerminalProcess[] } = await fetchGet(
        `/projects/${encodeURIComponent(projectId)}/terminal-processes?versions=${encodeURIComponent(JSON.stringify(versions))}`,
        undefined,
        undefined,
        { signal: AbortSignal.timeout(5000) }
      );
      if ((generations.get(projectId) ?? 0) !== generation) return;
      set((state) => {
        const next = reconcileProcesses(previous, response.processes);
        if (
          next.length === previous.length &&
          next.every((process, index) => process === previous[index])
        )
          return state;
        return {
          projects: { ...state.projects, [projectId]: next },
        };
      });
    } catch {
      if ((generations.get(projectId) ?? 0) !== generation) return;
      // Retained output is still useful, but an unreachable owner is not live.
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: previous.map((p) => ({
            ...p,
            status: 'unavailable',
            can_stop: false,
          })),
        },
      }));
    } finally {
      fetching.delete(projectId);
    }
  },
  async stop(projectId, id) {
    const update = (patch: Partial<TerminalProcess>) =>
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: (state.projects[projectId] ?? []).map((p) =>
            p.id === id ? { ...p, ...patch } : p
          ),
        },
      }));
    const process = get().projects[projectId]?.find((p) => p.id === id);
    if (!process?.can_stop || process.status === 'stopping') return;
    generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
    update({ status: 'stopping', stop_error: null });
    try {
      update(
        await fetchPost(
          `/projects/${encodeURIComponent(projectId)}/terminal-processes/${encodeURIComponent(id)}/stop`,
          {}
        )
      );
    } catch {
      update({ status: process.status, stop_error: 'stop-failed' });
    } finally {
      generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
    }
  },
}));

const subscriptions = new Map<
  string,
  { count: number; timer: ReturnType<typeof setInterval> }
>();
/** One poll per Session regardless of how many Summary/viewer consumers mount. */
export function subscribeTerminalProcesses(projectId: string) {
  const existing = subscriptions.get(projectId);
  if (existing) existing.count++;
  else {
    void useTerminalProcessStore.getState().refresh(projectId);
    const timer = setInterval(() => {
      void useTerminalProcessStore.getState().refresh(projectId);
    }, 1000);
    subscriptions.set(projectId, { count: 1, timer });
  }
  return () => {
    const entry = subscriptions.get(projectId);
    if (entry && --entry.count === 0) {
      clearInterval(entry.timer);
      subscriptions.delete(projectId);
    }
  };
}
