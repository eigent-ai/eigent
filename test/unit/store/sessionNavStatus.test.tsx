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

import { SessionNavListRows } from '@/components/SpaceSidebar/SessionNavListRows';
import { useSessionNavStatuses } from '@/hooks/useSessionNavStatuses';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  DURABLE_RUN_STATUS_CHANGED_EVENT,
  notifyDurableRunStatusChanged,
} from '@/lib/events/durableRunEvents';
import {
  normalizeLegacyChatStep,
  normalizeLocalRunEvent,
} from '@/lib/projector';
import { RunEventIngress, runProjectionStore } from '@/lib/runEvents';
import {
  getSessionNavLeadFromHistoryTask,
  resolveSessionNavLeadPresentation,
} from '@/lib/sessionNavLead';
import { refreshSessionNavStatuses } from '@/service/sessionNavStatus';
import type { ServerProject } from '@/service/spaceApi';
import { getAuthStore, useAuthStore } from '@/store/authStore';
import {
  createChatStoreInstance,
  settleLegacyTaskFromCanonicalTerminal,
} from '@/store/chatStore';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../fixtures/session-status/journal-outcomes.json';

const { fetchGet, ipc } = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  ipc: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/host', () => ({ useHost: () => ({ ipcRenderer: ipc }) }));
vi.mock('@/api/http', async (original) => ({
  ...(await original<typeof import('@/api/http')>()),
  fetchGet,
}));

const outcomes = {
  completed: 'finished',
  failed: 'error',
  cancelled: 'idle',
  interrupted: 'warning',
} as const;
const icons = {
  completed: 'circle-check-big',
  failed: 'circle-slash',
  cancelled: 'message-circle',
  interrupted: 'triangle-alert',
};

function coldProject(projectId: string) {
  useProjectStore.getState().upsertProjectsFromServer([
    {
      id: projectId,
      space_id: 'space-nav',
      name: projectId,
      status: 'active',
    } as ServerProject,
  ]);
  useProjectStore.getState().setProjectNavLeads({
    [projectId]: getSessionNavLeadFromHistoryTask({ status: 2, summary: '' }),
  });
}

function Rows({
  projectId,
  folded = false,
}: {
  projectId: string;
  folded?: boolean;
}) {
  const state = useProjectStore();
  return (
    <SessionNavListRows
      folded={folded}
      showRowMenu={false}
      sessions={[
        {
          id: projectId,
          title: projectId,
          sessionLead: resolveSessionNavLeadPresentation({
            cachedLead: state.navLeadByProjectId[projectId],
            isHistoryLoading: !!state.historyLoadingProjectIds[projectId],
          }),
        },
      ]}
    />
  );
}
beforeEach(() => {
  useSpaceStore.setState({
    activeSpaceId: 'space-nav',
    projectsBySpaceId: {},
    projectIdIndex: {},
  });
  useProjectStore.setState({
    projects: {},
    activeProjectId: null,
    navLeadByProjectId: {},
    historyLoadingProjectIds: {},
  });
  resetProjectEventStoresForTests();
  runProjectionStore.clear();
  fetchGet.mockReset();
  ipc.on.mockReset();
  ipc.off.mockReset();
});
afterEach(cleanup);

describe('Session navigation through production projections', () => {
  it.each(fixtures)(
    'keeps $summary.status consistent before opening, after hydration and renderer reload',
    async ({ summary, events }) => {
      const { project_id: projectId, run_id: runId } = summary;
      const outcome = summary.status as keyof typeof outcomes;
      const ingress = new RunEventIngress(projectId, runId);
      // Same journal identity is replayed into both production read models.
      coldProject(projectId);
      const view = render(<Rows projectId={projectId} />);
      expect(
        view.container.querySelector('.lucide-circle-check-big')
      ).toBeNull();
      for (const event of events) {
        act(() => {
          ingress.ingest(event, 'historical_rehydrate');
          getProjectEventStore(projectId).enqueue(
            normalizeLocalRunEvent(event, projectId)
          );
          getProjectEventStore(projectId).flushAll();
        });
      }
      expect(runProjectionStore.getRun(projectId, runId)?.status).toBe(outcome);
      expect(
        getProjectEventStore(projectId).getSnapshot().view.runs[runId].status
      ).toBe(outcome);
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[outcome]);
      expect(
        view.container.querySelector(`.lucide-${icons[outcome]}`)
      ).not.toBeNull();

      // Opening replaces the cold row with a legacy history/cache Task marked FINISHED.
      const chat = createChatStoreInstance();
      chat.getState().create(runId, 'replay');
      chat.getState().setDurableRunStatus(runId, outcome);
      chat.getState().setStatus(runId, ChatTaskStatus.FINISHED);
      const cached = JSON.parse(JSON.stringify(chat.getState().tasks[runId]));
      act(() => {
        useProjectStore.getState().setHistoryLoadingProject(projectId, true);
        const project = useProjectStore.getState().projects[projectId];
        useProjectStore.setState({
          projects: {
            ...useProjectStore.getState().projects,
            [projectId]: {
              ...project,
              activeChatId: 'chat',
              chatStores: { chat },
            },
          },
        });
        useProjectStore.getState().setHistoryLoadingProject(projectId, false);
      });
      expect(chat.getState().tasks[runId]).toMatchObject({
        status: 'finished',
        durableRunStatus: outcome,
      });
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[outcome]);
      expect(
        view.container.querySelector(`.lucide-${icons[outcome]}`)
      ).not.toBeNull();

      // Cold renderer: only GET /runs summary is needed; no event replay or ChatTask.
      act(() => {
        useProjectStore.setState({ projects: {}, navLeadByProjectId: {} });
        resetProjectEventStoresForTests();
        runProjectionStore.clear();
        coldProject(projectId);
      });
      fetchGet.mockResolvedValue({ project_id: projectId, runs: [summary] });
      await act(async () =>
        refreshSessionNavStatuses(
          [projectId],
          getAccountEnvironmentKey(getAuthStore()),
          () => true
        )
      );
      expect(fetchGet).toHaveBeenCalledTimes(1);
      expect(fetchGet).toHaveBeenCalledWith(
        '/runs',
        { project_id: projectId, limit: 1 },
        undefined,
        expect.objectContaining({
          expectedAccountKey: getAccountEnvironmentKey(getAuthStore()),
        })
      );
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[outcome]);
      expect(
        view.container.querySelector(`.lucide-${icons[outcome]}`)
      ).not.toBeNull();
      // Reopening a serialized cache cannot change the result either.
      const restored = createChatStoreInstance();
      restored.getState().hydrateTask(runId, cached);
      act(() => {
        const state = useProjectStore.getState();
        useProjectStore.setState({
          projects: {
            ...state.projects,
            [projectId]: {
              ...state.projects[projectId],
              activeChatId: 'restored',
              chatStores: { restored },
            },
          },
        });
      });
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[outcome]);
    }
  );

  it.each(fixtures)(
    'observes background $summary.status even when only the companion timeline advances',
    ({ summary, events }) => {
      const { project_id: projectId, run_id: runId } = summary;
      coldProject(projectId);
      const chat = createChatStoreInstance();
      chat.getState().create(runId, 'chat');
      chat.getState().setStatus(runId, ChatTaskStatus.RUNNING);
      const state = useProjectStore.getState();
      useProjectStore.setState({
        projects: {
          ...state.projects,
          [projectId]: {
            ...state.projects[projectId],
            activeChatId: 'chat',
            chatStores: { chat },
          },
        },
      });
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe('running');
      for (const event of events)
        getProjectEventStore(projectId).enqueue(
          normalizeLocalRunEvent(event, projectId)
        );
      getProjectEventStore(projectId).flushAll();
      expect(chat.getState().tasks[runId].status).toBe('running');
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[summary.status as keyof typeof outcomes]);
      // #1969 can subsequently settle the compatibility lane without changing the icon.
      settleLegacyTaskFromCanonicalTerminal(chat, runId, {
        eventType: events.at(-1)!.event_type,
        payload: {},
      });
      expect(
        useProjectStore.getState().navLeadByProjectId[projectId].kind
      ).toBe(outcomes[summary.status as keyof typeof outcomes]);
    }
  );

  it('does not borrow an older completed Run for a newly started Task or another Session', () => {
    const { summary } = fixtures[0];
    coldProject(summary.project_id);
    runProjectionStore.upsertRunSummaries(summary.project_id, [summary as any]);
    const chat = createChatStoreInstance();
    chat.getState().create('new-run', 'chat');
    chat.getState().setStatus('new-run', ChatTaskStatus.RUNNING);
    const state = useProjectStore.getState();
    useProjectStore.setState({
      projects: {
        ...state.projects,
        [summary.project_id]: {
          ...state.projects[summary.project_id],
          activeChatId: 'chat',
          chatStores: { chat },
        },
      },
    });
    expect(
      useProjectStore.getState().navLeadByProjectId[summary.project_id].kind
    ).toBe('running');
    coldProject('other-project');
    expect(
      useProjectStore.getState().navLeadByProjectId['other-project'].kind
    ).toBe('idle');
  });

  it('rejects a late summary after an account switch', async () => {
    const { summary } = fixtures[0];
    coldProject(summary.project_id);
    let finish!: (response: unknown) => void;
    fetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const before = useAuthStore.getState().user_id;
    const request = refreshSessionNavStatuses(
      [summary.project_id],
      getAccountEnvironmentKey(getAuthStore()),
      () => true
    );
    useAuthStore.setState({ user_id: 987654 });
    finish({ project_id: summary.project_id, runs: [summary] });
    await request;
    expect(
      runProjectionStore.getRun(summary.project_id, summary.run_id)
    ).toBeNull();
    useAuthStore.setState({ user_id: before });
  });
  it('uses the newer same-Run checkpoint during Resume and ignores an older completion', async () => {
    const { summary } = fixtures[3];
    coldProject(summary.project_id);
    runProjectionStore.upsertRunSummaries(summary.project_id, [summary as any]);
    expect(
      useProjectStore.getState().navLeadByProjectId[summary.project_id].kind
    ).toBe('warning');
    getProjectEventStore(summary.project_id).reconcileRunSummary(
      {
        ...summary,
        status: 'running',
        version: summary.version + 1,
      } as any,
      getProjectEventStore(summary.project_id).getIncarnation()
    );
    expect(
      useProjectStore.getState().navLeadByProjectId[summary.project_id].kind
    ).toBe('running');
    fetchGet.mockResolvedValue({
      project_id: summary.project_id,
      runs: [{ ...summary, status: 'completed', version: summary.version - 1 }],
    });
    await refreshSessionNavStatuses(
      [summary.project_id],
      getAccountEnvironmentKey(getAuthStore()),
      () => true
    );
    expect(
      useProjectStore.getState().navLeadByProjectId[summary.project_id].kind
    ).toBe('running');
  });

  it.each(['response owner', 'run owner', 'removed Session', 'offline'])(
    'does not claim success with %s evidence',
    async (boundary) => {
      const { summary } = fixtures[0];
      coldProject(summary.project_id);
      fetchGet.mockImplementation(async () => {
        if (boundary === 'offline') throw new Error('offline');
        return {
          project_id:
            boundary === 'response owner'
              ? 'another-project'
              : summary.project_id,
          runs: [
            {
              ...summary,
              project_id:
                boundary === 'run owner'
                  ? 'another-project'
                  : summary.project_id,
            },
          ],
        };
      });
      await refreshSessionNavStatuses(
        [summary.project_id],
        getAccountEnvironmentKey(getAuthStore()),
        () => boundary !== 'removed Session'
      );
      expect(
        useProjectStore.getState().navLeadByProjectId[summary.project_id].kind
      ).toBe('idle');
    }
  );

  it('updates a persisted metadata-only Session when cloud Project sync is unavailable', async () => {
    const { summary } = fixtures[3];
    useSpaceStore.getState().upsertProjectMetas([
      {
        id: summary.project_id,
        spaceId: 'space-nav',
        name: 'Persisted Session',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const view = render(<Rows projectId={summary.project_id} />);
    fetchGet.mockResolvedValue({
      project_id: summary.project_id,
      runs: [summary],
    });
    await act(async () =>
      refreshSessionNavStatuses(
        [summary.project_id],
        getAccountEnvironmentKey(getAuthStore()),
        () => true
      )
    );
    expect(
      useProjectStore.getState().projects[summary.project_id]
    ).toBeUndefined();
    expect(
      runProjectionStore.getRun(summary.project_id, summary.run_id)?.status
    ).toBe('interrupted');
    expect(
      view.container.querySelector('.lucide-triangle-alert')
    ).not.toBeNull();
  });

  it('shares the concurrency bound across staggered overlapping refreshes', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `staggered-${index}`);
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    fetchGet.mockImplementation(async (_url, params) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return { project_id: params.project_id, runs: [] };
    });
    const accountKey = getAccountEnvironmentKey(getAuthStore());
    const first = refreshSessionNavStatuses(
      ids.slice(0, 8),
      accountKey,
      () => true
    );
    releases.splice(0, 2).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second call overlaps queued and active Projects but also adds new ones.
    const second = refreshSessionNavStatuses(
      ids.slice(6),
      accountKey,
      () => true
    );
    while (active > 0) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([first, second]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(
      fetchGet.mock.calls.map(([, params]) => params.project_id).sort()
    ).toEqual([...ids].sort());
  });

  it('refreshes only the event owner and reconciles the visible list on focus/backend-ready', async () => {
    const ids = ['event-a', 'event-b', 'event-c'];
    ids.forEach(coldProject);
    fetchGet.mockImplementation(async (_url, params) => ({
      project_id: params.project_id,
      runs: [],
    }));
    const hook = renderHook(() => useSessionNavStatuses(ids, 'space-nav'));
    await waitFor(() => expect(fetchGet).toHaveBeenCalledTimes(3));
    await act(async () => {});
    fetchGet.mockClear();
    await act(async () => notifyDurableRunStatusChanged('event-b'));
    expect(fetchGet.mock.calls.map(([, params]) => params.project_id)).toEqual([
      'event-b',
    ]);
    fetchGet.mockClear();
    await act(async () => {
      notifyDurableRunStatusChanged('outside-space');
      window.dispatchEvent(new CustomEvent(DURABLE_RUN_STATUS_CHANGED_EVENT));
    });
    expect(fetchGet).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(fetchGet).toHaveBeenCalledTimes(3);
    fetchGet.mockClear();
    await act(async () => ipc.on.mock.calls[0][1]());
    expect(fetchGet).toHaveBeenCalledTimes(3);
    hook.unmount();
    expect(ipc.off).toHaveBeenCalledWith(
      'backend-ready',
      ipc.on.mock.calls[0][1]
    );
    fetchGet.mockClear();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(fetchGet).not.toHaveBeenCalled();
  });

  it('cancels active and queued reads on Space change and unmount, rejecting late results', async () => {
    const firstIds = Array.from(
      { length: 8 },
      (_, index) => `old-space-${index}`
    );
    firstIds.forEach(coldProject);
    useSpaceStore.getState().upsertProjectMetas([
      {
        id: 'new-space-project',
        spaceId: 'new-space',
        name: 'New Session',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const releases: (() => void)[] = [];
    fetchGet.mockImplementation(
      (_url, params) =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({
              project_id: params.project_id,
              runs: [
                {
                  ...fixtures[0].summary,
                  project_id: params.project_id,
                },
              ],
            })
          );
        })
    );
    const hook = renderHook(
      ({ ids, spaceId }) => useSessionNavStatuses(ids, spaceId),
      {
        initialProps: { ids: firstIds, spaceId: 'space-nav' },
      }
    );
    expect(fetchGet).toHaveBeenCalledTimes(4);
    const oldSignals = fetchGet.mock.calls.map(
      (call) => call[3].signal as AbortSignal
    );
    await act(async () => {
      useSpaceStore.setState({ activeSpaceId: 'new-space' });
      hook.rerender({ ids: ['new-space-project'], spaceId: 'new-space' });
    });
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    expect(fetchGet.mock.calls.map(([, params]) => params.project_id)).toEqual([
      ...firstIds.slice(0, 4),
      'new-space-project',
    ]);
    const lastSignal = fetchGet.mock.calls[4][3].signal as AbortSignal;
    await act(async () => hook.unmount());
    expect(lastSignal.aborted).toBe(true);
    await act(async () => releases.forEach((release) => release()));
    for (const id of [...firstIds, 'new-space-project']) {
      expect(
        runProjectionStore.getRun(id, fixtures[0].summary.run_id)
      ).toBeNull();
    }
  });

  it('retains a shared read until its final subscriber leaves', async () => {
    const projectId = 'shared-lifetime';
    let release!: (response: unknown) => void;
    fetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const firstLifetime = new AbortController();
    const secondLifetime = new AbortController();
    const accountKey = getAccountEnvironmentKey(getAuthStore());
    const first = refreshSessionNavStatuses(
      [projectId],
      accountKey,
      () => true,
      firstLifetime.signal
    );
    const second = refreshSessionNavStatuses(
      [projectId],
      accountKey,
      () => true,
      secondLifetime.signal
    );
    expect(fetchGet).toHaveBeenCalledTimes(1);
    firstLifetime.abort();
    await first;
    expect(fetchGet.mock.calls[0][3].signal.aborted).toBe(false);
    release({
      project_id: projectId,
      runs: [{ ...fixtures[3].summary, project_id: projectId }],
    });
    await second;
    expect(
      runProjectionStore.getRun(projectId, fixtures[3].summary.run_id)?.status
    ).toBe('interrupted');
  });

  it('releases timed-out slots so the queue and later retries can finish', async () => {
    vi.useFakeTimers();
    try {
      fetchGet.mockImplementation(() => new Promise(() => {}));
      const ids = Array.from({ length: 6 }, (_, index) => `timeout-${index}`);
      const accountKey = getAccountEnvironmentKey(getAuthStore());
      const refresh = refreshSessionNavStatuses(ids, accountKey, () => true);
      expect(fetchGet).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1200);
      expect(fetchGet).toHaveBeenCalledTimes(6);
      expect(
        fetchGet.mock.calls.slice(0, 4).every((call) => call[3].signal.aborted)
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(1200);
      await refresh;
      expect(fetchGet.mock.calls.every((call) => call[3].signal.aborted)).toBe(
        true
      );
      fetchGet.mockResolvedValue({ project_id: ids[0], runs: [] });
      await refreshSessionNavStatuses([ids[0]], accountKey, () => true);
      expect(fetchGet).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes queued account reads before admitting a new account', async () => {
    const previousUser = useAuthStore.getState().user_id;
    const ids = Array.from({ length: 8 }, (_, index) => `account-${index}`);
    fetchGet.mockImplementation(() => new Promise(() => {}));
    const first = refreshSessionNavStatuses(
      ids,
      getAccountEnvironmentKey(getAuthStore()),
      () => true
    );
    expect(fetchGet).toHaveBeenCalledTimes(4);
    try {
      useAuthStore.setState({ user_id: 7654321 });
      await first;
      expect(fetchGet.mock.calls.every((call) => call[3].signal.aborted)).toBe(
        true
      );
      fetchGet.mockResolvedValue({ project_id: 'next-account', runs: [] });
      await refreshSessionNavStatuses(
        ['next-account'],
        getAccountEnvironmentKey(getAuthStore()),
        () => true
      );
      expect(fetchGet).toHaveBeenCalledTimes(5);
      expect(fetchGet.mock.calls[4][3].expectedAccountKey).toBe(
        getAccountEnvironmentKey(getAuthStore())
      );
    } finally {
      useAuthStore.setState({ user_id: previousUser });
    }
  });

  it('bounds summary concurrency without requesting transcripts or SSE', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `project-${index}`);
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    fetchGet.mockImplementation(async (_url, params) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return { project_id: params.project_id, runs: [] };
    });
    const pending = refreshSessionNavStatuses(
      ids,
      getAccountEnvironmentKey(getAuthStore()),
      () => true
    );
    expect(fetchGet).toHaveBeenCalledTimes(4);
    while (fetchGet.mock.calls.length < ids.length || active > 0) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await pending;
    expect(peak).toBe(4);
    expect(fetchGet).toHaveBeenCalledTimes(9);
    expect(
      fetchGet.mock.calls.every(
        ([url, params]) => url === '/runs' && params.limit === 1
      )
    ).toBe(true);
  });
  it('does not promote a legacy END projection over an interrupted hydrated Task', () => {
    const projectId = 'legacy-interrupted';
    const runId = 'legacy-run';
    coldProject(projectId);
    const chat = createChatStoreInstance();
    chat.getState().create(runId, 'replay');
    chat.getState().setDurableRunStatus(runId, 'interrupted');
    chat.getState().setStatus(runId, ChatTaskStatus.FINISHED);
    const state = useProjectStore.getState();
    useProjectStore.setState({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          activeChatId: 'chat',
          chatStores: { chat },
        },
      },
    });
    const eventStore = getProjectEventStore(projectId);
    eventStore.enqueue(
      normalizeLegacyChatStep(
        { step: 'end', data: {} },
        { projectId, runId, sequence: 1 }
      )
    );
    eventStore.flushAll();
    expect(eventStore.getSnapshot().view.runs[runId]).toMatchObject({
      status: 'completed',
      runVersion: 0,
    });
    expect(useProjectStore.getState().navLeadByProjectId[projectId].kind).toBe(
      'warning'
    );
  });
});
