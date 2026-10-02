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

import { EventNativeProjectTimeline } from '@/components/ChatBox/EventNativeProjectTimeline';
import { ProjectEventRuntimeProvider } from '@/hooks/useProjectEventRuntime';
import { enqueueChatEventProjection } from '@/store/chatEventProjectionBridge';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/failedFollowupHistory.json';

const http = vi.hoisted(() => ({ get: vi.fn(), stream: vi.fn() }));
vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: http.get,
  fetchPost: vi.fn(async () => ({})),
  proxyFetchGet: vi.fn(async (url: string) =>
    url.includes('snapshots') ? [] : { tasks: [], items: [] }
  ),
  sseTransport: http.stream,
  waitForBackendReady: vi.fn(async () => true),
  getBaseURL: vi.fn(async () => 'http://fixture.invalid'),
}));
vi.mock('@/lib/projectCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projectCache')>()),
  deleteCachedProject: vi.fn(),
  getCachedProject: vi.fn(async () => null),
  putCachedProject: vi.fn(),
}));
// This regression concerns the existing legacy/cloud history route.
vi.mock('@/store/sessionExecutionStore', () => ({
  requireLegacyExecution: vi.fn(),
  readSessionExecutionRoute: async ({ projectId }: { projectId: string }) => ({
    project_id: projectId,
    route: 'legacy',
  }),
  getSessionExecutionState: ({ projectId }: { projectId: string }) => ({
    route: { project_id: projectId, route: 'legacy' },
    managed: false,
  }),
}));

beforeEach(() => {
  vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
  vi.clearAllMocks();
  resetProjectEventStoresForTests();
  useProjectStore.setState({
    activeProjectId: null,
    projects: {},
    historyLoadingProjectIds: {},
    historyLoadIncompleteProjectIds: {},
    staleProjectIds: new Set(),
  });
  useSpaceStore.setState({
    activeSpaceId: 'space_test',
    spaces: {
      space_test: {
        id: 'space_test',
        name: 'Test Space',
        sourceType: 'blank',
        status: 'active',
        schemaVersion: SPACE_SCHEMA_VERSION,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    lastVisitedProjectBySpace: {},
    projectsBySpaceId: {},
    projectIdIndex: {},
    projectsSyncedAt: {},
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  resetProjectEventStoresForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Captured from improve(201) -> step_solve/single_agent_solve -> provider 403
// -> sync_step -> Cloud ChatStep storage -> run_playback. This keeps the contiguous
// journal sequence. confirmed has no invented source_event_id.
describe('failed follow-up history', () => {
  it.each(['history-first', 'canonical-first'] as const)(
    'keeps one query through loadProject, hydration and mode changes (%s)',
    async (order) => {
      const { projectId, runId, question, events, cloudFrames } = fixture;
      const last = events.at(-1)!;
      let localAvailable = order === 'canonical-first';
      http.get.mockImplementation(async (url: string) => {
        if (url.includes('/events'))
          return {
            run_id: runId,
            events,
            next_sequence: last.sequence,
            has_more: false,
          };
        if (url.includes('/runs')) {
          if (!localAvailable)
            throw new Error('Local journal temporarily unavailable');
          return {
            project_id: projectId,
            runs: [
              {
                run_id: runId,
                status: 'failed',
                version: last.sequence,
                origin: 'local',
                updated_at: last.created_at,
              },
            ],
          };
        }
        return {};
      });
      http.stream.mockImplementation(async (options) => {
        for (const raw of options.url.includes('/runs/')
          ? events
          : cloudFrames) {
          await options.onmessage?.({ data: JSON.stringify(raw) });
        }
        options.onclose?.();
      });
      const store = getProjectEventStore(projectId);
      const tree = (mode: 'narrative' | 'trajectory') => (
        <ProjectEventRuntimeProvider projectId={projectId}>
          <EventNativeProjectTimeline
            projectId={projectId}
            detailLevel={mode}
            scrollBottomInsetPx={128}
          />
        </ProjectEventRuntimeProvider>
      );
      let ui: ReturnType<typeof render> | undefined;
      try {
        if (order === 'canonical-first') {
          ui = render(tree('trajectory'));
          await waitFor(() =>
            expect(store.getSnapshot().hasHydratedSnapshot).toBe(true)
          );
          localAvailable = false;
        }
        await act(async () => {
          await useProjectStore
            .getState()
            .loadProjectFromHistory([runId], question, projectId);
          store.flushAll();
        });
        expect(
          http.stream.mock.calls.some(([options]) =>
            options.url.includes('playback')
          )
        ).toBe(true);
        const historical = store
          .getSnapshot()
          .chat.nodes.find(
            (n) => n.eventType === 'legacy.step' && n.legacyStep === 'confirmed'
          );
        if (order === 'history-first') expect(historical).toBeDefined();
        expect(historical?.sourceEventId).toBeUndefined();
        localAvailable = true;
        ui ??= render(tree('trajectory'));
        await waitFor(() =>
          expect(store.getSnapshot().hasHydratedSnapshot).toBe(true)
        );
        const canonical = events.find((e) => e.event_type === 'user.message')!;
        // Presentation arbitration must not delete either source event.
        expect(
          store
            .getSnapshot()
            .chat.nodes.some((n) => n.eventId === canonical.event_id)
        ).toBe(true);
        if (historical)
          expect(
            store
              .getSnapshot()
              .chat.nodes.some((n) => n.eventId === historical.eventId)
          ).toBe(true);
        await act(async () => {
          // Re-delivery after an ACK loss must not resurrect an input row.
          for (let delivery = 0; delivery < 2; delivery++)
            enqueueChatEventProjection(
              {
                raw: canonical,
                projectId,
                runId,
                sequence: canonical.sequence,
                sourceId: 'reconnected-stream',
                transport: 'local_run',
              },
              true,
              true
            );
          store.flushAll();
        });
        for (const mode of ['trajectory', 'narrative', 'trajectory'] as const) {
          ui.rerender(tree(mode));
          expect(
            ui.container.querySelectorAll('[data-message-role="user"]')
          ).toHaveLength(1);
          expect(ui.container.textContent).toContain(question);
        }
        ui.unmount();
        ui = render(tree('trajectory'));
        expect(
          ui.container.querySelectorAll('[data-message-role="user"]')
        ).toHaveLength(1);
        ui.unmount();
        // A cold renderer restart rebuilds both stores from the same wire
        // history instead of reusing the already-hydrated projection.
        resetProjectEventStoresForTests();
        useProjectStore.setState({ projects: {}, activeProjectId: null });
        await act(async () => {
          await useProjectStore
            .getState()
            .loadProjectFromHistory([runId], question, projectId);
          getProjectEventStore(projectId).flushAll();
        });
        ui = render(tree('trajectory'));
        await waitFor(() =>
          expect(
            getProjectEventStore(projectId).getSnapshot().hasHydratedSnapshot
          ).toBe(true)
        );
        expect(
          ui.container.querySelectorAll('[data-message-role="user"]')
        ).toHaveLength(1);
      } finally {
        ui?.unmount();
      }
    }
  );
});
