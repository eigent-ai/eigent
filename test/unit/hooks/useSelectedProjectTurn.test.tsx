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

import { useSelectedProjectTurn } from '@/hooks/useSelectedProjectTurn';
import { usePageTabStore } from '@/store/pageTabStore';
import { ProjectType, useProjectStore } from '@/store/projectStore';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('useSelectedProjectTurn', () => {
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

  it('subscribes to and updates the selected turn owning store', () => {
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
    projectStore.setActiveChatStore(projectId, latestChatId!);

    act(() => {
      usePageTabStore.getState().setSidePanelSelectedTurn(projectId, oldTaskId);
    });

    const { result } = renderHook(() => useSelectedProjectTurn(projectId));

    expect(result.current.chatStore).toBe(oldStore);
    expect(result.current.taskId).toBe(oldTaskId);

    act(() => {
      oldStore!.getState().setSummaryTask(oldTaskId, 'Updated old run');
    });

    expect(result.current.task?.summaryTask).toBe('Updated old run');

    act(() => {
      result.current.chatStore?.getState().setSelectedFile(oldTaskId, {
        name: 'old.md',
        path: '/old.md',
        type: 'md',
      });
    });

    expect(oldStore!.getState().tasks[oldTaskId].selectedFile?.name).toBe(
      'old.md'
    );
    expect(latestStore!.getState().tasks[latestTaskId].selectedFile).toBeNull();
  });

  it('falls back to the active turn when the saved selection is unavailable', () => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.createProject(
      'Project',
      undefined,
      'project-active'
    );
    const activeStore = projectStore.getActiveChatStore(projectId)!;
    const activeTaskId = activeStore.getState().activeTaskId!;

    usePageTabStore.setState({
      sidePanelSelectedTurnByProject: {
        [projectId]: 'missing-task',
      },
    });

    const { result } = renderHook(() => useSelectedProjectTurn(projectId));

    expect(result.current.chatStore).toBe(activeStore);
    expect(result.current.taskId).toBe(activeTaskId);
  });
});
