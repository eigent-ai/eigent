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

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  let state = {
    activeProjectId: 'a' as string | null,
    setActiveProject: (id: string | null) => {
      state = { ...state, activeProjectId: id };
      listeners.forEach((listener) => listener());
    },
  };
  const listeners = new Set<() => void>();
  const useStore = (selector: (s: typeof state) => unknown) => selector(state);
  useStore.getState = () => state;
  useStore.subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { useStore, listeners };
});

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: runtime.useStore,
}));
vi.mock('@/store/spaceStore', () => {
  const state = {
    getProjectMeta: (id: string) => ({ id, spaceId: 'space' }),
  };
  const useSpaceStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useSpaceStore.getState = () => state;
  return { useSpaceStore };
});
vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Session', () => ({
  default: ({
    projectId,
    headerActions,
  }: {
    projectId?: string;
    headerActions?: ReactNode;
  }) => (
    <section aria-label={`Session ${projectId ?? 'standalone'}`}>
      {headerActions}
    </section>
  ),
}));

import { SessionSplitView } from '@/components/Session/SplitView';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';

function renderSplit() {
  const view = render(<SessionSplitView />);
  // The mocked runtime store is not reactive; re-render on focus changes.
  runtime.listeners.add(() => view.rerender(<SessionSplitView />));
  return view;
}

describe('SessionSplitView', () => {
  beforeEach(() => {
    runtime.listeners.clear();
    runtime.useStore.getState().setActiveProject('a');
    useSessionWindowsStore.setState({ openProjectIds: [] });
    useSessionSplitViewStore.setState({
      panesBySpaceId: { space: ['a', 'b'] },
    });
  });

  it('gives every pane a close button and a resize handle between panes', () => {
    renderSplit();
    for (const id of ['a', 'b'])
      expect(
        within(screen.getByLabelText(`Session ${id}`)).getByRole('button', {
          name: 'Close pane',
        })
      ).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('closes the left pane, keeps the right one and moves focus to it', async () => {
    const user = userEvent.setup();
    renderSplit();
    await user.click(
      within(screen.getByLabelText('Session a')).getByRole('button', {
        name: 'Close pane',
      })
    );
    expect(useSessionSplitViewStore.getState().panesBySpaceId).toEqual({});
    expect(runtime.useStore.getState().activeProjectId).toBe('b');
    expect(screen.getByLabelText('Session standalone')).toBeInTheDocument();
  });

  it('closes one of three panes and keeps the split', async () => {
    const user = userEvent.setup();
    act(() =>
      useSessionSplitViewStore.setState({
        panesBySpaceId: { space: ['a', 'b', 'c'] },
      })
    );
    renderSplit();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    await user.click(
      within(screen.getByLabelText('Session b')).getByRole('button', {
        name: 'Close pane',
      })
    );
    expect(useSessionSplitViewStore.getState().panesBySpaceId.space).toEqual([
      'a',
      'c',
    ]);
    expect(runtime.useStore.getState().activeProjectId).toBe('a');
  });
});
