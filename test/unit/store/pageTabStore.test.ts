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

import { usePageTabStore } from '@/store/pageTabStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('pageTabStore side-panel requests', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      activeWorkspaceTab: 'workforce',
      unviewedTabs: new Set(),
      filesUnviewedForProjects: new Set(),
      taskBoxFocusRequestId: 0,
      taskBoxFocusProjectId: null,
      taskBoxFocusTaskId: null,
      scrollToTurnRequest: null,
      sessionSidePanelToggleRequestId: 0,
    });
  });

  it('scopes task-card focus requests to a project and task', () => {
    usePageTabStore.getState().requestTaskBoxFocus('project-1', 'task-2');

    expect(usePageTabStore.getState()).toMatchObject({
      taskBoxFocusRequestId: 1,
      taskBoxFocusProjectId: 'project-1',
      taskBoxFocusTaskId: 'task-2',
    });
  });

  it('stores a one-shot historical Run scroll request', () => {
    const request = { projectId: 'project-1', taskId: 'task-1' };
    usePageTabStore.getState().setScrollToTurnRequest(request);
    expect(usePageTabStore.getState().scrollToTurnRequest).toEqual(request);

    usePageTabStore.getState().setScrollToTurnRequest(null);
    expect(usePageTabStore.getState().scrollToTurnRequest).toBeNull();
  });

  it('publishes one-shot session side-panel toggle requests', () => {
    usePageTabStore.getState().requestToggleSessionSidePanel();
    usePageTabStore.getState().requestToggleSessionSidePanel();

    expect(usePageTabStore.getState().sessionSidePanelToggleRequestId).toBe(2);
  });

  it('tracks unread project files and clears the active project when Files opens', () => {
    usePageTabStore.getState().markTabAsUnviewed('files', 'project-1');
    usePageTabStore.getState().markTabAsUnviewed('files', 'project-2');

    usePageTabStore.getState().setActiveWorkspaceTab('files', {
      clearFilesForProjectId: 'project-1',
    });

    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('files');
    expect(usePageTabStore.getState().unviewedTabs).toEqual(new Set(['files']));
    expect(usePageTabStore.getState().filesUnviewedForProjects).toEqual(
      new Set(['project-2'])
    );
  });
});
