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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  backendReady: true,
  meta: { id: 'p1', spaceId: 's1', name: 'Plan launch' } as unknown,
  activeProjectId: null as string | null,
  setActiveProject: vi.fn(),
  setActiveSpace: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  returnToMain: vi.fn().mockResolvedValue(undefined),
  link: vi.fn(),
}));

vi.mock('@/hooks/useInstallationSetup', () => ({
  useInstallationSetup: vi.fn(),
}));
vi.mock('@/store/installationStore', () => ({
  useInstallationUI: () => ({ isBackendReady: state.backendReady }),
}));
vi.mock('@/hooks/useSessionWindows', () => ({
  useSessionWindowLink: state.link,
}));
vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: state.ensureLoaded,
}));
vi.mock('@/lib/projectWorkspaceRoot', () => ({
  selectProjectWorkspaceRoot: () => null,
}));
vi.mock('@/lib/spaceLabel', () => ({
  getSessionMetaDisplayName: (meta: { name: string }) => meta.name,
  getActiveSpaceTriggerLabel: () => 'Space one',
}));
vi.mock('@/lib/sessionWindows', () => ({
  returnSessionWindowToMain: state.returnToMain,
}));
vi.mock('@/host', () => ({ useHost: () => null }));
vi.mock('@/store/spaceStore', () => {
  const store = {
    getProjectMeta: () => state.meta,
    get activeSpaceId() {
      return 'other';
    },
    spaces: { s1: { name: 'Space one' } },
    setActiveSpace: state.setActiveSpace,
  };
  const useSpaceStore = (selector: (s: typeof store) => unknown) =>
    selector(store);
  useSpaceStore.getState = () => store;
  return { useSpaceStore };
});
vi.mock('@/store/projectRuntimeStore', () => {
  const store = {
    get activeProjectId() {
      return state.activeProjectId;
    },
    setActiveProject: (id: string) => {
      state.activeProjectId = id;
      state.setActiveProject(id);
    },
  };
  const useProjectRuntimeStore = (selector: (s: typeof store) => unknown) =>
    selector(store);
  useProjectRuntimeStore.getState = () => store;
  return { useProjectRuntimeStore };
});
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: {
    getState: () => ({ setActiveWorkspaceTab: state.setActiveWorkspaceTab }),
  },
}));
vi.mock('@/components/Layout/AppShellLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock(
  '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer',
  () => ({ PreviewBrowserLayer: () => null })
);
vi.mock('@/components/Session', () => ({
  default: () => <section aria-label="Session view" />,
}));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import SessionWindowPage from '@/pages/SessionWindow';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/session-window/s1/p1']}>
      <Routes>
        <Route
          path="/session-window/:spaceId/:projectId"
          element={<SessionWindowPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('Session window page', () => {
  beforeEach(() => {
    state.backendReady = true;
    state.meta = { id: 'p1', spaceId: 's1', name: 'Plan launch' };
    state.activeProjectId = null;
    vi.clearAllMocks();
  });

  it('waits for the Brain before selecting the Session', () => {
    state.backendReady = false;
    renderPage();
    expect(screen.getByText('Opening session…')).toBeInTheDocument();
    expect(state.setActiveProject).not.toHaveBeenCalled();
  });

  it('selects its Session in its Space, loads it and shows it', async () => {
    const { rerender } = renderPage();
    expect(state.link).toHaveBeenCalledWith({ spaceId: 's1', projectId: 'p1' });
    expect(state.setActiveSpace).toHaveBeenCalledWith('s1');
    expect(state.setActiveProject).toHaveBeenCalledWith('p1');
    expect(state.setActiveWorkspaceTab).toHaveBeenCalledWith('project');
    expect(state.ensureLoaded).toHaveBeenCalledWith(expect.anything(), 'p1', {
      requireActiveSelection: true,
    });
    rerender(
      <MemoryRouter initialEntries={['/session-window/s1/p1']}>
        <Routes>
          <Route
            path="/session-window/:spaceId/:projectId"
            element={<SessionWindowPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByLabelText('Session view')).toBeInTheDocument();
    expect(document.title).toBe('Plan launch');
  });

  it('hands the Session back from the top bar', async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in main window' })
    );
    expect(state.returnToMain).toHaveBeenCalledWith({
      spaceId: 's1',
      projectId: 'p1',
    });
  });

  it('says when the Session no longer exists and offers to close', () => {
    state.meta = null;
    renderPage();
    expect(
      screen.getByText('This session is no longer available')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close window' })
    ).toBeInTheDocument();
    expect(state.setActiveProject).not.toHaveBeenCalled();
  });
});
