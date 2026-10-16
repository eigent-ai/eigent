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

import { ProjectChatContainer } from '@/components/ChatBox/ProjectChatContainer';
import { TaskCard } from '@/components/ChatBox/TaskBox/TaskCard';
import { SessionPaneProvider } from '@/hooks/useSessionPane';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { act, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const projectStore = { getAllChatStores: () => [] };
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    projectStore,
    chatStore: {
      activeTaskId: 'task',
      tasks: { task: { status: 'finished' } },
    },
  }),
}));

function Pane({ id }: { id: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  return (
    <SessionPaneProvider projectId={id}>
      <div ref={scroll} data-testid={id}>
        <div data-query-id="query" data-turn-id="task">
          <div data-task-card="true" />
        </div>
        <ProjectChatContainer
          scrollContainerRef={scroll}
          scrollBottomInsetPx={0}
        />
      </div>
    </SessionPaneProvider>
  );
}

beforeEach(() => {
  useProjectRuntimeStore.setState({ activeProjectId: 'b' });
  usePageTabStore.setState({
    scrollToQueryId: null,
    scrollToQueryProjectId: null,
    taskBoxFocusRequestId: 0,
    taskBoxFocusProjectId: null,
    taskBoxFocusTaskId: null,
  });
});

it('routes unscoped query and task requests only to the focused pane without replaying on focus changes', () => {
  render(
    <>
      <Pane id="a" />
      <Pane id="b" />
    </>
  );
  const scrollA = vi.fn();
  const scrollB = vi.fn();
  screen.getByTestId('a').scrollTo = scrollA;
  screen.getByTestId('b').scrollTo = scrollB;
  act(() => usePageTabStore.getState().setScrollToQueryId('query'));
  expect(scrollA).not.toHaveBeenCalled();
  expect(scrollB).toHaveBeenCalledTimes(1);
  act(() => usePageTabStore.getState().requestTaskBoxFocus());
  expect(scrollA).not.toHaveBeenCalled();
  expect(scrollB).toHaveBeenCalledTimes(2);
  act(() => useProjectRuntimeStore.setState({ activeProjectId: 'a' }));
  expect(scrollA).not.toHaveBeenCalled();
  expect(scrollB).toHaveBeenCalledTimes(2);
});

it('honors explicit targets even when another pane is focused', () => {
  render(
    <>
      <Pane id="a" />
      <Pane id="b" />
    </>
  );
  const scrollA = vi.fn();
  const scrollB = vi.fn();
  screen.getByTestId('a').scrollTo = scrollA;
  screen.getByTestId('b').scrollTo = scrollB;
  act(() => usePageTabStore.getState().setScrollToQueryId('query', 'a'));
  act(() => usePageTabStore.getState().requestTaskBoxFocus('a', 'task'));
  expect(scrollA).toHaveBeenCalledTimes(2);
  expect(scrollB).not.toHaveBeenCalled();
});

it('expands only the requested task card and does not replay the request after a focus change', () => {
  window.sessionStorage.clear();
  render(
    <>
      {['a', 'b'].map((id) => (
        <SessionPaneProvider key={id} projectId={id}>
          <div data-testid={id}>
            <TaskCard
              chatId={id}
              taskId="task"
              taskInfo={[]}
              taskAssigning={[]}
              taskRunning={[]}
              taskType={2}
              summaryTask="Plan"
              progressValue={0}
              onAddTask={() => {}}
              onUpdateTask={() => {}}
              onSaveTask={() => {}}
              onDeleteTask={() => {}}
            />
          </div>
        </SessionPaneProvider>
      ))}
    </>
  );
  const a = within(screen.getByTestId('a'));
  const b = within(screen.getByTestId('b'));
  expect(a.queryByText('0/0')).toBeNull();
  expect(b.queryByText('0/0')).toBeNull();
  act(() => usePageTabStore.getState().requestTaskBoxFocus());
  expect(a.queryByText('0/0')).toBeNull();
  expect(b.getByText('0/0')).toBeInTheDocument();
  act(() => useProjectRuntimeStore.setState({ activeProjectId: 'a' }));
  expect(a.queryByText('0/0')).toBeNull();
  act(() => usePageTabStore.getState().requestTaskBoxFocus('a', 'task'));
  expect(a.getByText('0/0')).toBeInTheDocument();
});
