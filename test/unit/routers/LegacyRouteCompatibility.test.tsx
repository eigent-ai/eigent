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

import type { NewSpaceDialogProps } from '@/components/Home/NewSpaceDialog';
import {
  LEGACY_WORKFLOW_QUERY_KEY,
  LegacyRouteRedirect,
  LegacyRouteWorkflowDialog,
  type LegacyRouteKind,
} from '@/routers/LegacyRouteCompatibility';
import { useSpaceStore } from '@/store/spaceStore';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: true,
  newSpaceDialog: vi.fn((_props: NewSpaceDialogProps) => null),
  createBlankSpace: vi.fn(async () => true),
  createSpaceFromFolder: vi.fn(async () => true),
}));

vi.mock('@/client/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/platform')>()),
  isDesktop: () => mocks.desktop,
}));

vi.mock('@/components/Home/NewSpaceDialog', () => ({
  default: mocks.newSpaceDialog,
}));

vi.mock('@/components/Home/hooks/useNewSpaceCreation', () => ({
  useNewSpaceCreation: () => ({
    createBlankSpace: mocks.createBlankSpace,
    createSpaceFromFolder: mocks.createSpaceFromFolder,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      })}
    </output>
  );
}

function locationSnapshot() {
  return JSON.parse(screen.getByTestId('location').textContent || '{}') as {
    pathname: string;
    search: string;
    state: unknown;
  };
}

async function renderRedirect({
  kind,
  path,
  entry,
  state,
}: {
  kind: LegacyRouteKind;
  path: string;
  entry: string;
  state?: unknown;
}) {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: entry.split('?')[0],
          search: entry.includes('?') ? `?${entry.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route path={path} element={<LegacyRouteRedirect kind={kind} />} />
        <Route path="/home" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(locationSnapshot().pathname).toBe('/home'));
  return locationSnapshot();
}

afterEach(() => {
  mocks.desktop = true;
  useSpaceStore.setState({ activeSpaceId: null });
  mocks.newSpaceDialog.mockClear();
});

describe('LegacyRouteRedirect', () => {
  it.each([
    {
      entry: '/history?tab=agents&section=memory&trace=keep',
      expected: { section: 'settings', tab: 'memory' },
    },
    {
      entry: '/history?tab=mcp_tools&connectorAction=add&trace=keep',
      expected: { section: 'settings', tab: 'connectors' },
    },
    {
      entry:
        '/history?tab=browser&browserSection=extension&browserAction=launch&trace=keep',
      expected: { section: 'settings', tab: 'browser-plugins' },
    },
    {
      entry: '/history?tab=projects&trace=keep',
      expected: { section: 'spaces', tab: null },
    },
  ])(
    'maps $entry into the current Home surface',
    async ({ entry, expected }) => {
      const routeState = { from: 'legacy-link' };
      const snapshot = await renderRedirect({
        kind: 'history',
        path: '/history',
        entry,
        state: routeState,
      });
      const params = new URLSearchParams(snapshot.search);

      expect(params.get('section')).toBe(expected.section);
      expect(params.get('tab')).toBe(expected.tab);
      expect(params.get('trace')).toBe('keep');
      expect(snapshot.state).toEqual(routeState);
    }
  );

  it('translates browserSection while retaining supported browser actions', async () => {
    const snapshot = await renderRedirect({
      kind: 'history',
      path: '/history',
      entry: '/history?tab=browser&browserSection=cdp&browserAction=launch',
    });
    const params = new URLSearchParams(snapshot.search);

    expect(params.get('browserSection')).toBeNull();
    expect(params.get('browserAction')).toBe('launch');
    expect(params.get('tab')).toBe('browser-connections');
  });

  it.each([
    {
      kind: 'workspace-bundle-install' as const,
      path: '/workspace-bundles/install',
      entry:
        '/workspace-bundles/install?handle=%40owner%2Fbundle%401&proposal=p-1&trace=keep',
      workflow: 'workspace-bundle',
    },
    {
      kind: 'agent-plugin-import' as const,
      path: '/agent-plugins/import',
      entry: '/agent-plugins/import?target_space_id=space-2&trace=keep',
      workflow: 'agent-plugin',
    },
  ])('opens $path in the current dialog workflow', async (testCase) => {
    const snapshot = await renderRedirect(testCase);
    const params = new URLSearchParams(snapshot.search);

    expect(params.get('section')).toBe('spaces');
    expect(params.get(LEGACY_WORKFLOW_QUERY_KEY)).toBe(testCase.workflow);
    expect(params.get('trace')).toBe('keep');
  });

  it('keeps the retired Agent Plugin route Desktop-only', async () => {
    mocks.desktop = false;

    render(
      <MemoryRouter initialEntries={['/agent-plugins/import?trace=keep']}>
        <Routes>
          <Route
            path="/agent-plugins/import"
            element={<LegacyRouteRedirect kind="agent-plugin-import" />}
          />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(locationSnapshot().pathname).toBe('/'));
    expect(locationSnapshot().search).toBe('');
  });

  it('targets the requested Space profile and preserves the original query alias', async () => {
    const snapshot = await renderRedirect({
      kind: 'workspace-configuration',
      path: '/workspace-configuration',
      entry: '/workspace-configuration?space_id=space-from-query&trace=keep',
      state: { spaceId: 'space-from-state', from: 'legacy-link' },
    });
    const params = new URLSearchParams(snapshot.search);

    expect(params.get('section')).toBe('spaces');
    expect(params.get('spaceId')).toBe('space-from-query');
    expect(params.get('space_id')).toBe('space-from-query');
    expect(params.get('spaceTab')).toBe('workspace-profile');
    expect(params.get('trace')).toBe('keep');
    expect(snapshot.state).toEqual({
      spaceId: 'space-from-state',
      from: 'legacy-link',
    });
  });

  it('falls back to the active Space for a configuration link without an id', async () => {
    useSpaceStore.setState({ activeSpaceId: 'active-space' });
    const snapshot = await renderRedirect({
      kind: 'workspace-configuration',
      path: '/workspace-configuration',
      entry: '/workspace-configuration?trace=keep',
    });
    const params = new URLSearchParams(snapshot.search);

    expect(params.get('spaceId')).toBe('active-space');
    expect(params.get('spaceTab')).toBe('workspace-profile');
  });

  it('falls back to the Spaces list when no configuration target is available', async () => {
    const snapshot = await renderRedirect({
      kind: 'workspace-configuration',
      path: '/workspace-configuration',
      entry: '/workspace-configuration?trace=keep',
    });
    const params = new URLSearchParams(snapshot.search);

    expect(params.get('section')).toBe('spaces');
    expect(params.get('spaceId')).toBeNull();
    expect(params.get('spaceTab')).toBeNull();
  });
});

describe('LegacyRouteWorkflowDialog', () => {
  it('passes bundle query values into the current New Space dialog', () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/home',
            search:
              '?section=spaces&legacyWorkflow=workspace-bundle&handle=%40owner%2Fbundle%401&proposal=p-1',
          },
        ]}
      >
        <LegacyRouteWorkflowDialog />
      </MemoryRouter>
    );

    expect(mocks.newSpaceDialog.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        open: true,
        initialPage: 'workspace-bundle',
        initialWorkspaceBundleHandle: '@owner/bundle@1',
        initialWorkspaceBundleProposalId: 'p-1',
      })
    );
  });

  it('retains state and unconsumed query values when the dialog closes', async () => {
    const routeState = { from: 'legacy-link', targetSpaceId: 'space-state' };
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/home',
            search:
              '?section=spaces&legacyWorkflow=agent-plugin&target_space_id=space-query&trace=keep',
            state: routeState,
          },
        ]}
      >
        <LegacyRouteWorkflowDialog />
        <LocationProbe />
      </MemoryRouter>
    );

    const props = mocks.newSpaceDialog.mock.calls.at(-1)?.[0];
    expect(props).toEqual(
      expect.objectContaining({
        initialPage: 'agent-plugin',
        initialAgentPluginTargetSpaceId: 'space-query',
        agentPluginTargetMode: 'existing',
      })
    );

    act(() => props?.onOpenChange(false));

    await waitFor(() => {
      const snapshot = locationSnapshot();
      const params = new URLSearchParams(snapshot.search);
      expect(params.get(LEGACY_WORKFLOW_QUERY_KEY)).toBeNull();
      expect(params.get('target_space_id')).toBe('space-query');
      expect(params.get('trace')).toBe('keep');
      expect(snapshot.state).toEqual(routeState);
    });
  });
});
