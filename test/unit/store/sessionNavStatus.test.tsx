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
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
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
import { ChatTaskStatus } from '@/types/constants';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../fixtures/session-status/journal-outcomes.json';

const { fetchGet } = vi.hoisted(() => ({ fetchGet: vi.fn() }));
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
  useProjectStore.setState({
    projects: {},
    activeProjectId: null,
    navLeadByProjectId: {},
    historyLoadingProjectIds: {},
  });
  resetProjectEventStoresForTests();
  runProjectionStore.clear();
  fetchGet.mockReset();
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
