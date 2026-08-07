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

import { useProjectSessionOverview } from '@/hooks/useProjectSessionOverview';
import { usePageTabStore } from '@/store/pageTabStore';
import { ProjectType, useProjectStore } from '@/store/projectStore';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('useProjectSessionOverview', () => {
  beforeEach(() => {
    useProjectStore.setState({
      activeProjectId: null,
      projects: {},
      navLeadByProjectId: {},
      historyLoadingProjectIds: {},
    });
    usePageTabStore.setState({
      sidePanelSelectedTurnByProject: {},
      sidePanelManualUntilByProject: {},
      sidePanelViewedTurnByProject: {},
    });
  });

  it('keeps the active run current while exposing every historical run', () => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.createProject(
      'History',
      undefined,
      'project-history',
      ProjectType.REPLAY
    );
    const oldChatId = projectStore.createChatStore(projectId, 'Old');
    const latestChatId = projectStore.createChatStore(projectId, 'Latest');
    const oldStore = projectStore.getChatStore(projectId, oldChatId!);
    const latestStore = projectStore.getChatStore(projectId, latestChatId!);
    const oldTaskId = oldStore!.getState().create('task-old');
    const latestTaskId = latestStore!.getState().create('task-latest');
    oldStore!.getState().addMessages(oldTaskId, {
      id: 'old-user',
      role: 'user',
      content: 'Old prompt',
    });
    latestStore!.getState().addMessages(latestTaskId, {
      id: 'latest-user',
      role: 'user',
      content: 'Latest prompt',
    });
    projectStore.setActiveChatStore(projectId, latestChatId!);

    act(() => {
      usePageTabStore.getState().setSidePanelSelectedTurn(projectId, oldTaskId);
    });

    const { result } = renderHook(() => useProjectSessionOverview(projectId));

    expect(result.current.currentRun?.taskId).toBe(latestTaskId);
    expect(result.current.runs.map((run) => run.taskId)).toEqual(
      expect.arrayContaining([oldTaskId, latestTaskId])
    );
    expect(
      result.current.historicalRuns.some((run) => run.taskId === oldTaskId)
    ).toBe(true);
  });

  it('keeps a newly created empty active run current', () => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.createProject(
      'New run',
      undefined,
      'project-new-run',
      ProjectType.REPLAY
    );
    const chatStore = projectStore.getActiveChatStore(projectId)!;
    const historicalTaskId = chatStore.getState().create('task-historical');
    chatStore.getState().addMessages(historicalTaskId, {
      id: 'historical-user',
      role: 'user',
      content: 'Previous prompt',
    });
    const emptyActiveTaskId = chatStore.getState().create('task-empty-active');
    chatStore.setState((state) => ({
      tasks: {
        ...state.tasks,
        [historicalTaskId]: {
          ...state.tasks[historicalTaskId],
          createdAt: 100,
        },
        [emptyActiveTaskId]: {
          ...state.tasks[emptyActiveTaskId],
          createdAt: 200,
        },
      },
    }));

    const { result } = renderHook(() => useProjectSessionOverview(projectId));

    expect(result.current.currentRun?.taskId).toBe(emptyActiveTaskId);
    expect(result.current.runs[0]?.taskId).toBe(emptyActiveTaskId);
    expect(result.current.historicalRuns.map((run) => run.taskId)).toContain(
      historicalTaskId
    );
  });
});
