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
import { SessionPaneProvider } from '@/hooks/useSessionPane';
import {
  recordResolvedRunModels,
  resetResolvedRunModelsForTest,
} from '@/service/projectRunsApi';
import { refreshSessionNavStatuses } from '@/service/sessionNavStatus';
import { ChatTaskStatus } from '@/types/constants';
import { act, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

const mocks = vi.hoisted(() => ({
  chatStores: [] as Array<{ chatId: string; chatStore: unknown }>,
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    projectStore: { getAllChatStores: () => mocks.chatStores },
    chatStore: { activeTaskId: null, tasks: {} },
  }),
}));
vi.mock('@/service/sessionNavStatus', () => ({
  refreshSessionNavStatuses: vi.fn(async () => undefined),
}));
vi.mock('@/components/ChatBox/UserQueryGroup', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/components/ChatBox/UserQueryGroup')
  >()),
  UserQueryGroup: ({
    queryGroup,
  }: {
    queryGroup: { userMessage?: { content: string } };
  }) => <article>{queryGroup.userMessage?.content}</article>,
}));

const refreshMock = vi.mocked(refreshSessionNavStatuses);

type Status = (typeof ChatTaskStatus)[keyof typeof ChatTaskStatus];

function task(id: string, status: Status = ChatTaskStatus.FINISHED) {
  return {
    status,
    messages: [{ id: `user-${id}`, role: 'user', content: `Query ${id}` }],
  };
}

function useTasks(tasks: Record<string, ReturnType<typeof task>>) {
  const chatStore = createStore(() => ({ activeTaskId: null, tasks }));
  mocks.chatStores = [{ chatId: 'chat-1', chatStore }];
  return chatStore;
}

function recordModels(models: Record<string, unknown>) {
  recordResolvedRunModels('project-1', {
    project_id: 'project-1',
    runs: Object.entries(models).map(([run_id, resolved_model]) => ({
      run_id,
      project_id: 'project-1',
      resolved_model,
    })),
  });
}

function Container() {
  const scroll = useRef<HTMLDivElement>(null);
  return (
    <SessionPaneProvider projectId="project-1">
      <div ref={scroll}>
        <ProjectChatContainer
          scrollContainerRef={scroll}
          scrollBottomInsetPx={0}
        />
      </div>
    </SessionPaneProvider>
  );
}

function dividers(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll('[data-model-change-divider]'),
    (divider) => divider.textContent
  );
}

const gpt = { platform: 'openai', type: 'gpt-4.1' };
const claude = { platform: 'anthropic', type: 'claude-sonnet-4' };

describe('legacy chat model changes', () => {
  beforeEach(() => {
    // jsdom has no scrolling; the container scrolls new Tasks into view.
    Element.prototype.scrollTo = vi.fn();
    resetResolvedRunModelsForTest();
    refreshMock.mockClear();
  });

  it('shows a divider above the first Task that ran on a different model', () => {
    useTasks({
      'run-1': task('run-1'),
      'run-2': task('run-2'),
      'run-3': task('run-3'),
      'run-4': task('run-4'),
    });
    recordModels({
      'run-1': gpt,
      'run-2': claude,
      'run-3': { platform: 'anthropic' },
      'run-4': claude,
    });

    const { container } = render(<Container />);

    expect(dividers(container)).toEqual(['Model changed to claude-sonnet-4']);
    const divider = container.querySelector('[data-model-change-divider]')!;
    expect(divider.closest('[data-turn-id]')).toHaveAttribute(
      'data-turn-id',
      'run-2'
    );
    // Nothing reads a Run list when the open Session has no active Task.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it.each([
    ['the same model', { 'run-1': gpt, 'run-2': { ...gpt } }],
    ['an unknown earlier model', { 'run-1': null, 'run-2': claude }],
    ['an unknown later model', { 'run-1': gpt, 'run-2': null }],
    ['no recorded models', {}],
  ])('shows no divider for %s', (_case, models) => {
    useTasks({ 'run-1': task('run-1'), 'run-2': task('run-2') });
    recordModels(models);
    const { container } = render(<Container />);
    expect(dividers(container)).toEqual([]);
  });

  it('never shows a divider before the first Task', () => {
    useTasks({ 'run-1': task('run-1') });
    recordModels({ 'run-1': claude });
    const { container } = render(<Container />);
    expect(dividers(container)).toEqual([]);
  });

  it('reads the newest Run when a Task starts and ends, then shows its model', async () => {
    const chatStore = useTasks({
      'run-1': task('run-1'),
      'run-2': task('run-2', ChatTaskStatus.RUNNING),
    });
    recordModels({ 'run-1': gpt, 'run-2': null });

    const { container } = render(<Container />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock.mock.calls[0][0]).toEqual(['project-1']);
    expect(dividers(container)).toEqual([]);

    act(() => {
      chatStore.setState({
        tasks: {
          'run-1': task('run-1'),
          'run-2': task('run-2', ChatTaskStatus.FINISHED),
        },
      });
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(2));

    act(() => recordModels({ 'run-2': claude }));
    await waitFor(() =>
      expect(dividers(container)).toEqual(['Model changed to claude-sonnet-4'])
    );
  });
});
