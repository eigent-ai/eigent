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

import {
  loadProjectFromHistory,
  replayActiveTask,
  replayProject,
} from '@/lib/replay';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// loadProjectFromHistory
// ---------------------------------------------------------------------------
describe('loadProjectFromHistory', () => {
  let projectStore: any;
  let navigate: any;

  beforeEach(() => {
    projectStore = {
      loadProjectFromHistory: vi.fn().mockResolvedValue(undefined),
    };
    navigate = vi.fn();
  });

  it('calls projectStore.loadProjectFromHistory with provided args', async () => {
    await loadProjectFromHistory(
      projectStore,
      navigate,
      'proj-1',
      'What is AI?',
      'hist-1'
    );

    expect(projectStore.loadProjectFromHistory).toHaveBeenCalledWith(
      ['proj-1'],
      'What is AI?',
      'proj-1',
      'hist-1',
      undefined
    );
  });

  it('defaults taskIdsList to [projectId] when not provided', async () => {
    await loadProjectFromHistory(
      projectStore,
      navigate,
      'proj-1',
      'Hello',
      'hist-1'
    );

    const callArgs = projectStore.loadProjectFromHistory.mock.calls[0];
    expect(callArgs[0]).toEqual(['proj-1']);
  });

  it('uses provided taskIdsList instead of default', async () => {
    await loadProjectFromHistory(
      projectStore,
      navigate,
      'proj-1',
      'Hello',
      'hist-1',
      ['task-a', 'task-b']
    );

    const callArgs = projectStore.loadProjectFromHistory.mock.calls[0];
    expect(callArgs[0]).toEqual(['task-a', 'task-b']);
  });

  it('passes projectName when provided', async () => {
    await loadProjectFromHistory(
      projectStore,
      navigate,
      'proj-1',
      'Q',
      'hist-1',
      undefined,
      'My Project'
    );

    const callArgs = projectStore.loadProjectFromHistory.mock.calls[0];
    expect(callArgs[4]).toBe('My Project');
  });

  it('navigates to "/" after loading', async () => {
    await loadProjectFromHistory(
      projectStore,
      navigate,
      'proj-1',
      'Q',
      'hist-1'
    );

    expect(navigate).toHaveBeenCalledWith({ pathname: '/' });
  });

  it('awaits projectStore.loadProjectFromHistory before navigating', async () => {
    let loadResolved = false;
    projectStore.loadProjectFromHistory.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      loadResolved = true;
    });

    await loadProjectFromHistory(projectStore, navigate, 'p', 'q', 'h');

    expect(loadResolved).toBe(true);
    expect(navigate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// replayProject
// ---------------------------------------------------------------------------
describe('replayProject', () => {
  let projectStore: any;
  let navigate: any;

  beforeEach(() => {
    projectStore = {
      replayProject: vi.fn(),
    };
    navigate = vi.fn();
  });

  it('calls projectStore.replayProject with provided args', async () => {
    await replayProject(
      projectStore,
      navigate,
      'proj-1',
      'Build a bot',
      'hist-1'
    );

    expect(projectStore.replayProject).toHaveBeenCalledWith(
      ['proj-1'],
      'Build a bot',
      'proj-1',
      'hist-1'
    );
  });

  it('defaults taskIdsList to [projectId] when not provided', async () => {
    await replayProject(projectStore, navigate, 'proj-2', 'Q', 'hist-2');

    const callArgs = projectStore.replayProject.mock.calls[0];
    expect(callArgs[0]).toEqual(['proj-2']);
  });

  it('uses provided taskIdsList instead of default', async () => {
    await replayProject(projectStore, navigate, 'proj-1', 'Q', 'hist-1', [
      'task-x',
      'task-y',
    ]);

    const callArgs = projectStore.replayProject.mock.calls[0];
    expect(callArgs[0]).toEqual(['task-x', 'task-y']);
  });

  it('navigates to "/" after replay', async () => {
    await replayProject(projectStore, navigate, 'p', 'q', 'h');

    expect(navigate).toHaveBeenCalledWith({ pathname: '/' });
  });

  it('does NOT await replayProject (fire-and-forget)', async () => {
    const spy = vi.fn();
    projectStore.replayProject = spy;

    await replayProject(projectStore, navigate, 'p', 'q', 'h');

    // replayProject was called but NOT awaited — navigate happens right after
    expect(spy).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// replayActiveTask
// ---------------------------------------------------------------------------
describe('replayActiveTask', () => {
  let chatStore: any;
  let projectStore: any;
  let navigate: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    chatStore = {
      activeTaskId: 'task-1',
      tasks: {},
    };

    projectStore = {
      activeProjectId: 'proj-1',
      projects: {},
      getHistoryId: vi.fn().mockReturnValue('hist-1'),
      replayProject: vi.fn(),
    };

    navigate = vi.fn();
  });

  it('logs error and returns early when taskId is missing', async () => {
    chatStore.activeTaskId = null;

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Missing taskId or projectId for replay'
    );
    expect(projectStore.replayProject).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('logs error and returns early when projectId is missing', async () => {
    projectStore.activeProjectId = null;

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Missing taskId or projectId for replay'
    );
    expect(projectStore.replayProject).not.toHaveBeenCalled();
  });

  it('replays using question from earliest chat store message', async () => {
    // Build a project with two chat stores at different timestamps
    const chatState1 = {
      tasks: {
        taskA: {
          messages: [{ role: 'user', content: '  First question  ' }],
        },
      },
    };
    const chatState2 = {
      tasks: {
        taskB: {
          messages: [{ role: 'user', content: 'Second question' }],
        },
      },
    };

    projectStore.projects = {
      'proj-1': {
        chatStores: {
          cs1: { getState: () => chatState1 },
          cs2: { getState: () => chatState2 },
        },
        chatStoreTimestamps: {
          cs1: 100,
          cs2: 200,
        },
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    // cs1 has the earliest timestamp → its question is used
    expect(projectStore.replayProject).toHaveBeenCalledWith(
      ['task-1'],
      'First question',
      'proj-1',
      'hist-1'
    );
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('picks the earliest user message by timestamp', async () => {
    const chatStateLate = {
      tasks: {
        t1: { messages: [{ role: 'user', content: 'Late message' }] },
      },
    };
    const chatStateEarly = {
      tasks: {
        t2: { messages: [{ role: 'user', content: 'Early message' }] },
      },
    };

    projectStore.projects = {
      'proj-1': {
        chatStores: {
          csLate: { getState: () => chatStateLate },
          csEarly: { getState: () => chatStateEarly },
        },
        chatStoreTimestamps: {
          csLate: 500,
          csEarly: 100,
        },
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    const question = projectStore.replayProject.mock.calls[0][1];
    expect(question).toBe('Early message');
  });

  it('skips assistant messages and finds first user message', async () => {
    const chatState = {
      tasks: {
        t1: {
          messages: [
            { role: 'assistant', content: 'Hi there' },
            { role: 'user', content: 'My actual question' },
          ],
        },
      },
    };

    projectStore.projects = {
      'proj-1': {
        chatStores: {
          cs1: { getState: () => chatState },
        },
        chatStoreTimestamps: { cs1: 100 },
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    const question = projectStore.replayProject.mock.calls[0][1];
    expect(question).toBe('My actual question');
  });

  it('falls back to chatStore.tasks message when no project chatStores', async () => {
    projectStore.projects = {
      'proj-1': {},
    };
    chatStore.tasks = {
      'task-1': {
        messages: [{ content: 'Fallback question' }],
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(projectStore.replayProject).toHaveBeenCalledWith(
      ['task-1'],
      'Fallback question',
      'proj-1',
      'hist-1'
    );
  });

  it('falls back to chatStore.tasks when project has no chatStores', async () => {
    projectStore.projects = {};
    chatStore.tasks = {
      'task-1': {
        messages: [{ content: 'Direct fallback' }],
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(projectStore.replayProject).toHaveBeenCalledWith(
      ['task-1'],
      'Direct fallback',
      'proj-1',
      'hist-1'
    );
  });

  it('passes undefined historyId when getHistoryId returns null', async () => {
    projectStore.getHistoryId.mockReturnValue(null);
    projectStore.projects = {};
    chatStore.tasks = {
      'task-1': {
        messages: [{ content: 'Q' }],
      },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(projectStore.replayProject).toHaveBeenCalledWith(
      ['task-1'],
      'Q',
      'proj-1',
      undefined
    );
  });

  it('uses empty string question when no messages found and no fallback', async () => {
    projectStore.projects = {};
    chatStore.tasks = {};

    await replayActiveTask(chatStore, projectStore, navigate);

    const question = projectStore.replayProject.mock.calls[0][1];
    expect(question).toBe('');
  });

  it('uses taskIdsList with the active task ID', async () => {
    projectStore.projects = {};
    chatStore.tasks = {
      'task-1': { messages: [{ content: 'Q' }] },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    const taskIdsList = projectStore.replayProject.mock.calls[0][0];
    expect(taskIdsList).toEqual(['task-1']);
  });

  it('navigates to "/" after replay', async () => {
    projectStore.projects = {};
    chatStore.tasks = {
      'task-1': { messages: [{ content: 'Q' }] },
    };

    await replayActiveTask(chatStore, projectStore, navigate);

    expect(navigate).toHaveBeenCalledWith('/');
  });
});
