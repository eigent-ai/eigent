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

describe('pageTabStore turn selection', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      sidePanelSelectedTurnByProject: {},
      sidePanelManualUntilByProject: {},
      sidePanelViewedTurnByProject: {},
      taskBoxFocusRequestId: 0,
      taskBoxFocusProjectId: null,
      taskBoxFocusTaskId: null,
      scrollToTurnRequest: null,
    });
  });

  it('holds manual selection until the selected turn reaches the viewport', () => {
    const store = usePageTabStore.getState();
    store.setSidePanelSelectedTurn('project-1', 'task-2', 5000);
    store.setSidePanelViewedTurn('project-1', 'task-1');

    expect(
      usePageTabStore.getState().sidePanelSelectedTurnByProject['project-1']
    ).toBe('task-2');

    store.setSidePanelViewedTurn('project-1', 'task-2');
    expect(
      usePageTabStore.getState().sidePanelManualUntilByProject['project-1']
    ).toBe(0);

    store.setSidePanelViewedTurn('project-1', 'task-1');
    expect(
      usePageTabStore.getState().sidePanelSelectedTurnByProject['project-1']
    ).toBe('task-1');
  });

  it('scopes task-card focus requests to a project and task', () => {
    usePageTabStore.getState().requestTaskBoxFocus('project-1', 'task-2');

    expect(usePageTabStore.getState()).toMatchObject({
      taskBoxFocusRequestId: 1,
      taskBoxFocusProjectId: 'project-1',
      taskBoxFocusTaskId: 'task-2',
    });
  });
});
