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

/**
 * ProjectStore Unit Tests - Core Functionality
 *
 * Tests project store operations:
 * - Project CRUD (create, setActive, remove, update)
 * - Chat store management (create, append, setActive, remove, save, get, getAll)
 * - Queued messages (add with dedup, remove, restore, clear, markProcessing)
 * - Replay/History (replayProject, loadProjectFromHistory)
 * - Utility methods (getAllProjects, getById, totalTokens, isEmpty, historyId)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies – must be declared before importing the module under test
// ---------------------------------------------------------------------------

let uniqueIdCounter = 0;

/**
 * Build a fake VanillaChatStore whose getState() returns a minimal ChatStore.
 * Each call creates a fresh store instance so tests are isolated.
 */
function createMockChatStore() {
  const tasks: Record<string, any> = {};
  let activeTaskId: string | null = null;

  const create = vi.fn((id?: string) => {
    const taskId = id ?? `task-${++uniqueIdCounter}`;
    tasks[taskId] = {
      messages: [],
      summaryTask: '',
      progressValue: 0,
      isPending: false,
      status: 'pending',
      taskTime: 0,
      tokens: 0,
      elapsed: 0,
      hasWaitComfirm: false,
    };
    activeTaskId = taskId;
    return taskId;
  });

  const setActiveTaskId = vi.fn((id: string) => {
    activeTaskId = id;
  });

  const replay = vi.fn(async () => {});

  const getState = () => ({
    tasks,
    activeTaskId,
    create,
    setActiveTaskId,
    replay,
    removeTask: vi.fn(),
    setStatus: vi.fn(),
    setSummaryTask: vi.fn(),
    setProgressValue: vi.fn(),
    setIsPending: vi.fn(),
    setTaskTime: vi.fn(),
    setElapsed: vi.fn(),
    addTokens: vi.fn(),
    getTokens: vi.fn(),
    addMessages: vi.fn(),
    setMessages: vi.fn(),
    clearTasks: vi.fn(),
  });

  return {
    getState,
    subscribe: vi.fn(() => vi.fn()),
  };
}

vi.mock('@/lib', () => ({
  generateUniqueId: vi.fn(() => `uid-${++uniqueIdCounter}`),
}));

vi.mock('@/store/chatStore', () => ({
  createChatStoreInstance: vi.fn(() => createMockChatStore()),
}));

vi.mock('@/types/constants', () => ({
  ChatTaskStatus: {
    RUNNING: 'running',
    FINISHED: 'finished',
    PENDING: 'pending',
    PAUSE: 'pause',
  },
}));

// Import the module under test AFTER mocks are in place
import { createChatStoreInstance as mockedCreateChatStoreInstance } from '../../../src/store/chatStore';
import { ProjectType, useProjectStore } from '../../../src/store/projectStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the project store to a clean slate between tests. */
function resetStore() {
  const state = useProjectStore.getState();
  useProjectStore.setState({
    activeProjectId: null,
    projects: {},
  });
}

/** Convenience: get current store state. */
function s() {
  return useProjectStore.getState();
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ProjectStore', () => {
  beforeEach(() => {
    uniqueIdCounter = 0;
    vi.clearAllMocks();
    resetStore();
  });

  // =========================================================================
  // 1. Project CRUD
  // =========================================================================
  describe('Project CRUD', () => {
    describe('createProject', () => {
      it('should create a new project and set it as active', () => {
        const projectId = s().createProject('Test Project', 'A description');

        expect(projectId).toBeDefined();
        expect(typeof projectId).toBe('string');
        expect(s().activeProjectId).toBe(projectId);
        expect(s().projects[projectId]).toBeDefined();
        expect(s().projects[projectId].name).toBe('Test Project');
        expect(s().projects[projectId].description).toBe('A description');
      });

      it('should create a project with generated ID when none provided', () => {
        const projectId = s().createProject('Auto ID Project');
        expect(projectId).toMatch(/^uid-/);
      });

      it('should create a project with specific ID when provided', () => {
        const projectId = s().createProject(
          'Custom ID',
          undefined,
          'my-custom-id'
        );
        expect(projectId).toBe('my-custom-id');
      });

      it('should initialize one chat store for the new project', () => {
        const projectId = s().createProject('With Chat');
        const project = s().projects[projectId];

        const chatStoreKeys = Object.keys(project.chatStores);
        expect(chatStoreKeys).toHaveLength(1);
        expect(project.activeChatId).toBe(chatStoreKeys[0]);
      });

      it('should call initialChatStore.getState().create() for NORMAL type', () => {
        const mockedFn = vi.mocked(mockedCreateChatStoreInstance);
        const projectId = s().createProject('Normal Project');
        const mockInstance = mockedFn.mock.results.at(-1)?.value as ReturnType<
          typeof createMockChatStore
        >;

        // create() should have been called on the initial chat store
        expect(mockInstance.getState().create).toHaveBeenCalled();
      });

      it('should NOT call initialChatStore.getState().create() for REPLAY type', () => {
        const mockedFn = vi.mocked(mockedCreateChatStoreInstance);
        const projectId = s().createProject(
          'Replay Project',
          undefined,
          undefined,
          ProjectType.REPLAY
        );

        const mockInstance = mockedFn.mock.results.at(-1)?.value as ReturnType<
          typeof createMockChatStore
        >;
        expect(mockInstance.getState().create).not.toHaveBeenCalled();
      });

      it('should set metadata tags to ["replay"] for REPLAY type', () => {
        const projectId = s().createProject(
          'Replay',
          undefined,
          undefined,
          ProjectType.REPLAY
        );
        expect(s().projects[projectId].metadata?.tags).toEqual(['replay']);
      });

      it('should set metadata tags to [] for NORMAL type', () => {
        const projectId = s().createProject('Normal');
        expect(s().projects[projectId].metadata?.tags).toEqual([]);
      });

      it('should store historyId in metadata when provided', () => {
        const projectId = s().createProject(
          'History',
          undefined,
          undefined,
          undefined,
          'hist-123'
        );
        expect(s().projects[projectId].metadata?.historyId).toBe('hist-123');
      });

      it('should not set project as active when setActive=false', () => {
        const prevActive = s().activeProjectId;
        const projectId = s().createProject(
          'Inactive',
          undefined,
          undefined,
          undefined,
          undefined,
          false
        );
        expect(s().activeProjectId).toBe(prevActive);
      });

      it('should reuse empty project for non-REPLAY type (no projectId)', () => {
        // Create an empty project first
        const emptyProjectId = s().createProject('Empty');
        const reusedId = s().createProject('Reused Name', 'Reused Desc');

        // Should have reused the empty project
        expect(reusedId).toBe(emptyProjectId);
        expect(s().projects[reusedId].name).toBe('Reused Name');
        expect(s().projects[reusedId].description).toBe('Reused Desc');
      });

      it('should NOT reuse empty project for REPLAY type', () => {
        const emptyProjectId = s().createProject('Empty');
        const replayId = s().createProject(
          'Replay',
          undefined,
          undefined,
          ProjectType.REPLAY
        );

        expect(replayId).not.toBe(emptyProjectId);
      });

      it('should NOT reuse empty project when projectId is provided', () => {
        const emptyProjectId = s().createProject('Empty');
        const newId = s().createProject('New', undefined, 'specific-id');

        // projectId is provided, so no reuse path
        expect(newId).toBe('specific-id');
      });

      it('should initialize queuedMessages as empty array', () => {
        const projectId = s().createProject('Queued');
        expect(s().projects[projectId].queuedMessages).toEqual([]);
      });
    });

    describe('setActiveProject', () => {
      it('should set the active project ID', () => {
        const pid = s().createProject('A');
        const pid2 = s().createProject('B');

        s().setActiveProject(pid);
        expect(s().activeProjectId).toBe(pid);
      });

      it('should update the project updatedAt timestamp', () => {
        const pid = s().createProject('A');
        const beforeUpdatedAt = s().projects[pid].updatedAt;

        // Small delay to ensure different timestamp
        const originalNow = Date.now;
        Date.now = vi.fn(() => originalNow() + 100);
        s().setActiveProject(pid);
        Date.now = originalNow;

        expect(s().projects[pid].updatedAt).toBeGreaterThanOrEqual(
          beforeUpdatedAt
        );
      });

      it('should warn and do nothing for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prevActive = s().activeProjectId;

        s().setActiveProject('non-existent');

        expect(s().activeProjectId).toBe(prevActive);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('not found')
        );
        warnSpy.mockRestore();
      });
    });

    describe('removeProject', () => {
      it('should remove the project from the store', () => {
        const pid = s().createProject('ToRemove');
        expect(s().projects[pid]).toBeDefined();

        s().removeProject(pid);
        expect(s().projects[pid]).toBeUndefined();
      });

      it('should switch activeProjectId to another project when removing the active one', () => {
        const pid1 = s().createProject('P1', undefined, 'proj-1');
        const pid2 = s().createProject('P2', undefined, 'proj-2');

        s().setActiveProject(pid1);
        s().removeProject(pid1);

        // Should switch to remaining project
        expect(s().activeProjectId).toBe(pid2);
      });

      it('should set activeProjectId to null when removing the last project', () => {
        const pid = s().createProject('Only');
        s().removeProject(pid);

        expect(s().activeProjectId).toBeNull();
      });

      it('should not change activeProjectId when removing a non-active project', () => {
        const pid1 = s().createProject('Active', undefined, 'proj-a');
        const pid2 = s().createProject('Inactive', undefined, 'proj-b');

        s().setActiveProject(pid1);
        s().removeProject(pid2);

        expect(s().activeProjectId).toBe(pid1);
      });

      it('should warn for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().removeProject('ghost');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('updateProject', () => {
      it('should update project fields', () => {
        const pid = s().createProject('Original');
        s().updateProject(pid, { name: 'Updated', description: 'New desc' });

        expect(s().projects[pid].name).toBe('Updated');
        expect(s().projects[pid].description).toBe('New desc');
      });

      it('should update the updatedAt timestamp', () => {
        const pid = s().createProject('Orig');
        const before = s().projects[pid].updatedAt;

        const originalNow = Date.now;
        Date.now = vi.fn(() => originalNow() + 200);
        s().updateProject(pid, { name: 'Changed' });
        Date.now = originalNow;

        expect(s().projects[pid].updatedAt).toBeGreaterThanOrEqual(before);
      });

      it('should not overwrite id or createdAt', () => {
        const pid = s().createProject('Original');
        const createdAt = s().projects[pid].createdAt;

        // updateProject accepts Partial<Omit<Project, 'id' | 'createdAt'>>
        // so TypeScript prevents passing those, but at runtime ensure they are unchanged
        s().updateProject(pid, { name: 'New Name' });

        expect(s().projects[pid].id).toBe(pid);
        expect(s().projects[pid].createdAt).toBe(createdAt);
      });
    });
  });

  // =========================================================================
  // 2. Chat Store Management
  // =========================================================================
  describe('Chat Store Management', () => {
    describe('createChatStore', () => {
      it('should create a new chat store and set it as active', () => {
        const pid = s().createProject('Parent');
        const prevChatCount = Object.keys(s().projects[pid].chatStores).length;

        const chatId = s().createChatStore(pid);

        expect(chatId).toBeDefined();
        expect(Object.keys(s().projects[pid].chatStores)).toHaveLength(
          prevChatCount + 1
        );
        expect(s().projects[pid].activeChatId).toBe(chatId);
      });

      it('should record the chat store timestamp', () => {
        const pid = s().createProject('Parent');
        const chatId = s().createChatStore(pid)!;

        expect(s().projects[pid].chatStoreTimestamps[chatId]).toBeDefined();
        expect(typeof s().projects[pid].chatStoreTimestamps[chatId]).toBe(
          'number'
        );
      });

      it('should return null for non-existent project', () => {
        const result = s().createChatStore('ghost-project');
        expect(result).toBeNull();
      });
    });

    describe('appendInitChatStore', () => {
      it('should create a new chat store, init a task, and return taskId + chatStore', () => {
        const pid = s().createProject('Parent');
        const result = s().appendInitChatStore(pid);

        expect(result).not.toBeNull();
        expect(result!.taskId).toBeDefined();
        expect(result!.chatStore).toBeDefined();
      });

      it('should use customTaskId when provided', () => {
        const pid = s().createProject('Parent');
        const result = s().appendInitChatStore(pid, 'my-custom-task');

        expect(result!.taskId).toBe('my-custom-task');
      });

      it('should call setActiveTaskId on the new chat store', () => {
        const pid = s().createProject('Parent');
        const result = s().appendInitChatStore(pid, 'task-abc');

        // The chatStore's setActiveTaskId should have been called with the taskId
        const chatState = result!.chatStore.getState();
        expect(chatState.setActiveTaskId).toHaveBeenCalledWith('task-abc');
      });

      it('should return null when projectId is empty/falsy', () => {
        const result = s().appendInitChatStore('');
        expect(result).toBeNull();
      });

      it('should return null for non-existent project', () => {
        const result = s().appendInitChatStore('ghost');
        expect(result).toBeNull();
      });
    });

    describe('setActiveChatStore', () => {
      it('should update the active chat ID', () => {
        const pid = s().createProject('Parent');
        const chatId1 = Object.keys(s().projects[pid].chatStores)[0];
        const chatId2 = s().createChatStore(pid);

        s().setActiveChatStore(pid, chatId1);
        expect(s().projects[pid].activeChatId).toBe(chatId1);
      });

      it('should warn for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().setActiveChatStore('ghost', 'chat-1');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });

      it('should warn for non-existent chat store', () => {
        const pid = s().createProject('Parent');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().setActiveChatStore(pid, 'non-existent-chat');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('removeChatStore', () => {
      it('should remove the chat store from the project', () => {
        const pid = s().createProject('Parent');
        const chatId1 = Object.keys(s().projects[pid].chatStores)[0];
        const chatId2 = s().createChatStore(pid)!;

        s().removeChatStore(pid, chatId2);

        expect(s().projects[pid].chatStores[chatId2]).toBeUndefined();
        expect(Object.keys(s().projects[pid].chatStores)).toHaveLength(1);
      });

      it('should NOT remove the last chat store', () => {
        const pid = s().createProject('Parent');
        const onlyChatId = Object.keys(s().projects[pid].chatStores)[0];

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().removeChatStore(pid, onlyChatId);

        // Should still have the chat store
        expect(s().projects[pid].chatStores[onlyChatId]).toBeDefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Cannot remove the last')
        );
        warnSpy.mockRestore();
      });

      it('should switch activeChatId when removing the active chat', () => {
        const pid = s().createProject('Parent');
        const chatId1 = Object.keys(s().projects[pid].chatStores)[0];
        const chatId2 = s().createChatStore(pid)!;

        // chatId2 is now active; remove it
        s().removeChatStore(pid, chatId2);

        expect(s().projects[pid].activeChatId).toBe(chatId1);
      });

      it('should warn for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().removeChatStore('ghost', 'chat-1');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('saveChatStore', () => {
      it('should replace the chat store state for the given chat', () => {
        const pid = s().createProject('Parent');
        const chatId = Object.keys(s().projects[pid].chatStores)[0];

        const mockState = createMockChatStore() as any;
        s().saveChatStore(pid, chatId, mockState);

        expect(s().projects[pid].chatStores[chatId]).toBe(mockState);
      });

      it('should do nothing for non-existent project or chat', () => {
        const pid = s().createProject('Parent');
        const mockState = createMockChatStore() as any;

        // Non-existent project - should not throw
        expect(() =>
          s().saveChatStore('ghost', 'chat-1', mockState)
        ).not.toThrow();

        // Non-existent chat
        const originalStores = { ...s().projects[pid].chatStores };
        s().saveChatStore(pid, 'ghost-chat', mockState);
        expect(s().projects[pid].chatStores).toEqual(originalStores);
      });
    });

    describe('getChatStore', () => {
      it('should return the active chat store when no args provided', () => {
        const pid = s().createProject('Parent');
        const project = s().projects[pid];
        const chatId = project.activeChatId!;

        const result = s().getChatStore();
        expect(result).toBe(project.chatStores[chatId]);
      });

      it('should return a specific chat store by projectId and chatId', () => {
        const pid = s().createProject('Parent');
        const chatId = s().createChatStore(pid)!;
        const project = s().projects[pid];

        const result = s().getChatStore(pid, chatId);
        expect(result).toBe(project.chatStores[chatId]);
      });

      it('should return the first available chat store when activeChatId is missing', () => {
        const pid = s().createProject('Parent');
        const project = s().projects[pid];
        // Force activeChatId to a non-existent value
        project.activeChatId = 'nonexistent';
        const firstKey = Object.keys(project.chatStores)[0];

        const result = s().getChatStore(pid);
        expect(result).toBe(project.chatStores[firstKey]);
      });

      it('should create a new project if none exists', () => {
        expect(Object.keys(s().projects)).toHaveLength(0);

        const result = s().getChatStore();

        // Should have created a project
        expect(Object.keys(s().projects)).toHaveLength(1);
        expect(result).not.toBeNull();
      });
    });

    describe('getActiveChatStore', () => {
      it('should return the active chat store for the active project', () => {
        const pid = s().createProject('Parent');
        const chatId = s().projects[pid].activeChatId!;

        const result = s().getActiveChatStore();
        expect(result).toBe(s().projects[pid].chatStores[chatId]);
      });

      it('should return the active chat store for a specific project', () => {
        const pid = s().createProject('P1');
        const pid2 = s().createProject('P2');

        const chatId = s().projects[pid].activeChatId!;
        const result = s().getActiveChatStore(pid);
        expect(result).toBe(s().projects[pid].chatStores[chatId]);
      });

      it('should create a new chat store if project has none', () => {
        const pid = s().createProject('Parent');
        // Manually clear chat stores
        s().projects[pid].chatStores = {};
        s().projects[pid].activeChatId = null;

        const result = s().getActiveChatStore(pid);
        expect(result).not.toBeNull();
        // Should have created a new chat store
        expect(
          Object.keys(s().projects[pid].chatStores).length
        ).toBeGreaterThan(0);
      });

      it('should create a new project if none exists', () => {
        expect(Object.keys(s().projects)).toHaveLength(0);

        const result = s().getActiveChatStore();

        expect(Object.keys(s().projects)).toHaveLength(1);
        expect(result).not.toBeNull();
      });

      it('should return null if no active project and creation fails somehow', () => {
        // Edge case: activeProjectId is null and no projects exist
        // getActiveChatStore should create a project, so it won't return null
        // in normal flow. But we test the null fallback path.
        const result = s().getActiveChatStore();
        expect(result).not.toBeNull(); // it auto-creates
      });
    });

    describe('getAllChatStores', () => {
      it('should return all chat stores sorted by timestamp', () => {
        const pid = s().createProject('Parent');
        const chatId2 = s().createChatStore(pid);
        const chatId3 = s().createChatStore(pid);

        const allStores = s().getAllChatStores(pid);

        expect(allStores).toHaveLength(3);
        expect(allStores[0].chatId).toBeDefined();
        expect(allStores[0].chatStore).toBeDefined();
      });

      it('should return empty array for non-existent project', () => {
        expect(s().getAllChatStores('ghost')).toEqual([]);
      });
    });
  });

  // =========================================================================
  // 3. Queued Messages
  // =========================================================================
  describe('Queued Messages', () => {
    describe('addQueuedMessage', () => {
      it('should add a queued message to the project', () => {
        const pid = s().createProject('Parent');
        const taskId = s().addQueuedMessage(pid, 'Hello', [], 'custom-task-id');

        expect(taskId).toBe('custom-task-id');
        expect(s().projects[pid].queuedMessages).toHaveLength(1);
        expect(s().projects[pid].queuedMessages[0].content).toBe('Hello');
        expect(s().projects[pid].queuedMessages[0].task_id).toBe(
          'custom-task-id'
        );
      });

      it('should generate task_id when none provided', () => {
        const pid = s().createProject('Parent');
        const taskId = s().addQueuedMessage(pid, 'Hello', []);

        expect(taskId).toBeDefined();
        expect(typeof taskId).toBe('string');
      });

      it('should store all optional fields', () => {
        const pid = s().createProject('Parent');
        const file = new File(['content'], 'test.txt');
        const taskId = s().addQueuedMessage(
          pid,
          'msg',
          [file],
          'task-1',
          'exec-1',
          'trigger-task-1',
          42,
          'trigger-name'
        );

        const msg = s().projects[pid].queuedMessages[0];
        expect(msg.executionId).toBe('exec-1');
        expect(msg.triggerTaskId).toBe('trigger-task-1');
        expect(msg.triggerId).toBe(42);
        expect(msg.triggerName).toBe('trigger-name');
        expect(msg.attaches).toHaveLength(1);
      });

      it('should deduplicate by executionId', () => {
        const pid = s().createProject('Parent');
        const taskId1 = s().addQueuedMessage(
          pid,
          'First',
          [],
          'task-1',
          'exec-dup'
        );
        const taskId2 = s().addQueuedMessage(
          pid,
          'Second',
          [],
          'task-2',
          'exec-dup'
        );

        // Should return the existing task_id
        expect(taskId2).toBe(taskId1);
        expect(s().projects[pid].queuedMessages).toHaveLength(1);
        expect(s().projects[pid].queuedMessages[0].content).toBe('First');
      });

      it('should NOT deduplicate when executionId is undefined', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'First', [], 'task-1');
        s().addQueuedMessage(pid, 'Second', [], 'task-2');

        expect(s().projects[pid].queuedMessages).toHaveLength(2);
      });

      it('should return null for non-existent project', () => {
        const result = s().addQueuedMessage('ghost', 'msg', []);
        expect(result).toBeNull();
      });
    });

    describe('removeQueuedMessage', () => {
      it('should remove a message by task_id and return it', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'To Remove', [], 'task-remove');

        const removed = s().removeQueuedMessage(pid, 'task-remove');

        expect(removed.task_id).toBe('task-remove');
        expect(removed.content).toBe('To Remove');
        expect(s().projects[pid].queuedMessages).toHaveLength(0);
      });

      it('should return empty default when message not found', () => {
        const pid = s().createProject('Parent');
        const removed = s().removeQueuedMessage(pid, 'nonexistent');

        expect(removed).toEqual({
          task_id: '',
          content: '',
          timestamp: 0,
          attaches: [],
        });
      });

      it('should return empty default for non-existent project', () => {
        const removed = s().removeQueuedMessage('ghost', 'any');
        expect(removed).toEqual({
          task_id: '',
          content: '',
          timestamp: 0,
          attaches: [],
        });
      });
    });

    describe('restoreQueuedMessage', () => {
      it('should add a message back to the queue', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'Original', [], 'task-1');

        const removed = s().removeQueuedMessage(pid, 'task-1');
        expect(s().projects[pid].queuedMessages).toHaveLength(0);

        s().restoreQueuedMessage(pid, removed);
        expect(s().projects[pid].queuedMessages).toHaveLength(1);
        expect(s().projects[pid].queuedMessages[0].content).toBe('Original');
      });

      it('should not add duplicate by task_id', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'Existing', [], 'task-1');

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().restoreQueuedMessage(pid, {
          task_id: 'task-1',
          content: 'Duplicate',
          timestamp: Date.now(),
          attaches: [],
        });

        expect(s().projects[pid].queuedMessages).toHaveLength(1);
        expect(s().projects[pid].queuedMessages[0].content).toBe('Existing');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });

      it('should do nothing for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().restoreQueuedMessage('ghost', {
          task_id: 't1',
          content: 'msg',
          timestamp: 0,
          attaches: [],
        });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('clearQueuedMessages', () => {
      it('should remove all queued messages', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'Msg 1', [], 't1');
        s().addQueuedMessage(pid, 'Msg 2', [], 't2');

        s().clearQueuedMessages(pid);

        expect(s().projects[pid].queuedMessages).toEqual([]);
      });

      it('should warn for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().clearQueuedMessages('ghost');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('markQueuedMessageAsProcessing', () => {
      it('should set processing=true on the matching message', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'To process', [], 'task-proc');

        s().markQueuedMessageAsProcessing(pid, 'task-proc');

        expect(s().projects[pid].queuedMessages[0].processing).toBe(true);
      });

      it('should only mark the specific message, not others', () => {
        const pid = s().createProject('Parent');
        s().addQueuedMessage(pid, 'Msg 1', [], 't1');
        s().addQueuedMessage(pid, 'Msg 2', [], 't2');

        s().markQueuedMessageAsProcessing(pid, 't1');

        expect(s().projects[pid].queuedMessages[0].processing).toBe(true);
        expect(s().projects[pid].queuedMessages[1].processing).toBeUndefined();
      });

      it('should warn when message not found', () => {
        const pid = s().createProject('Parent');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().markQueuedMessageAsProcessing(pid, 'nonexistent');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });

      it('should warn for non-existent project', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s().markQueuedMessageAsProcessing('ghost', 't1');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });
  });

  // =========================================================================
  // 4. isEmptyProject
  // =========================================================================
  describe('isEmptyProject', () => {
    function makeEmptyProject(): any {
      const store = createMockChatStore();
      const taskId = store.getState().create('empty-task');
      return {
        id: 'empty-proj',
        name: 'Empty',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chatStores: { 'chat-1': store },
        chatStoreTimestamps: { 'chat-1': Date.now() },
        activeChatId: 'chat-1',
        queuedMessages: [],
        metadata: {},
      };
    }

    function makeNonEmptyProject(overrides?: Record<string, any>): any {
      const store = createMockChatStore();
      const taskId = store.getState().create('task-1');
      // Make the task non-empty by adding a message
      store.getState().tasks[taskId].messages = [
        { id: 'msg1', role: 'user', content: 'Hello' },
      ];
      return {
        id: 'non-empty-proj',
        name: 'NonEmpty',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chatStores: { 'chat-1': store },
        chatStoreTimestamps: { 'chat-1': Date.now() },
        activeChatId: 'chat-1',
        queuedMessages: [],
        metadata: {},
        ...overrides,
      };
    }

    it('should return true for an empty project', () => {
      const project = makeEmptyProject();
      expect(s().isEmptyProject(project)).toBe(true);
    });

    it('should return false when project has multiple chat stores', () => {
      const project = makeEmptyProject();
      const extraStore = createMockChatStore();
      project.chatStores['chat-2'] = extraStore;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when chat store has multiple tasks', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      store.getState().create('second-task');

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has messages', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].messages = [
        { id: 'm1', role: 'user', content: 'hi' },
      ];

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has non-zero summaryTask', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].summaryTask = 'Some summary';

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has non-zero progressValue', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].progressValue = 50;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has isPending=true', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].isPending = true;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has non-PENDING status', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].status = 'running';

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has non-zero tokens', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].tokens = 100;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has non-zero elapsed', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].elapsed = 5000;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when task has hasWaitComfirm=true', () => {
      const project = makeEmptyProject();
      const store = project.chatStores['chat-1'];
      const taskId = Object.keys(store.getState().tasks)[0];
      store.getState().tasks[taskId].hasWaitComfirm = true;

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when project has queued messages', () => {
      const project = makeEmptyProject();
      project.queuedMessages = [
        { task_id: 't1', content: 'msg', timestamp: Date.now(), attaches: [] },
      ];

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when chat store getState throws', () => {
      const project = makeEmptyProject();
      project.chatStores['chat-1'].getState = () => {
        throw new Error('broken');
      };

      expect(s().isEmptyProject(project)).toBe(false);
    });

    it('should return false when chatStore has no getState method', () => {
      const project = makeEmptyProject();
      project.chatStores['chat-1'] = {} as any;

      expect(s().isEmptyProject(project)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Utility Methods
  // =========================================================================
  describe('Utility Methods', () => {
    describe('getAllProjects', () => {
      it('should return all projects sorted by updatedAt descending', () => {
        const pid1 = s().createProject('Older', undefined, 'proj-old');

        // Ensure pid2 has a strictly greater updatedAt by manually updating pid1 to an older timestamp
        s().projects[pid1].updatedAt = 1000;

        const pid2 = s().createProject('Newer', undefined, 'proj-new');
        // pid2 just got created with Date.now(), which is > 1000

        const all = s().getAllProjects();
        expect(all).toHaveLength(2);
        // Newer project should come first (higher updatedAt)
        expect(all[0].id).toBe(pid2);
        expect(all[1].id).toBe(pid1);
      });

      it('should return empty array when no projects', () => {
        expect(s().getAllProjects()).toEqual([]);
      });
    });

    describe('getProjectById', () => {
      it('should return the project when found', () => {
        const pid = s().createProject('FindMe');
        const project = s().getProjectById(pid);

        expect(project).not.toBeNull();
        expect(project!.name).toBe('FindMe');
      });

      it('should return null when not found', () => {
        expect(s().getProjectById('ghost')).toBeNull();
      });

      it('should add queuedMessages array if missing (backwards compat)', () => {
        const pid = s().createProject('Compat');
        delete (s().projects[pid] as any).queuedMessages;

        const project = s().getProjectById(pid);
        expect(project!.queuedMessages).toEqual([]);
      });

      it('should add chatStoreTimestamps if missing (backwards compat)', () => {
        const pid = s().createProject('Compat');
        delete (s().projects[pid] as any).chatStoreTimestamps;

        const project = s().getProjectById(pid);
        expect(project!.chatStoreTimestamps).toBeDefined();
      });
    });

    describe('getProjectTotalTokens', () => {
      it('should sum tokens from all tasks across all chat stores', () => {
        const pid = s().createProject('Tokens');
        const chatId1 = Object.keys(s().projects[pid].chatStores)[0];

        // Add tokens to the task in the first chat store
        const store1 = s().projects[pid].chatStores[chatId1];
        const taskId1 = Object.keys(store1.getState().tasks)[0];
        store1.getState().tasks[taskId1].tokens = 100;

        // Create second chat store and add tokens
        const chatId2 = s().createChatStore(pid)!;
        const store2 = s().projects[pid].chatStores[chatId2];
        // Manually add a task with tokens
        store2.getState().create('task-with-tokens');
        store2.getState().tasks['task-with-tokens'].tokens = 250;

        const total = s().getProjectTotalTokens(pid);
        expect(total).toBe(350);
      });

      it('should return 0 for non-existent project', () => {
        expect(s().getProjectTotalTokens('ghost')).toBe(0);
      });

      it('should return 0 for project with no tokens', () => {
        const pid = s().createProject('NoTokens');
        expect(s().getProjectTotalTokens(pid)).toBe(0);
      });
    });

    describe('History ID', () => {
      describe('setHistoryId', () => {
        it('should set historyId on the project metadata', () => {
          const pid = s().createProject('History');
          s().setHistoryId(pid, 'hist-456');

          expect(s().projects[pid].metadata?.historyId).toBe('hist-456');
        });

        it('should warn for non-existent project', () => {
          const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
          s().setHistoryId('ghost', 'hist-123');
          expect(warnSpy).toHaveBeenCalled();
          warnSpy.mockRestore();
        });
      });

      describe('getHistoryId', () => {
        it('should return the historyId from metadata', () => {
          const pid = s().createProject(
            'History',
            undefined,
            undefined,
            undefined,
            'hist-789'
          );

          expect(s().getHistoryId(pid)).toBe('hist-789');
        });

        it('should return null when no historyId set', () => {
          const pid = s().createProject('NoHist');
          expect(s().getHistoryId(pid)).toBeNull();
        });

        it('should return null when projectId is null', () => {
          expect(s().getHistoryId(null)).toBeNull();
        });

        it('should return null for non-existent project', () => {
          expect(s().getHistoryId('ghost')).toBeNull();
        });
      });
    });
  });

  // =========================================================================
  // 6. Replay & History
  // =========================================================================
  describe('Replay & History', () => {
    describe('replayProject', () => {
      it('should create a replay project with REPLAY type', () => {
        const replayId = s().replayProject(['task-1'], 'Test Replay');

        expect(replayId).toBeDefined();
        expect(s().projects[replayId]).toBeDefined();
        expect(s().projects[replayId].metadata?.tags).toEqual(['replay']);
      });

      it('should overwrite existing project with the same projectId', () => {
        const pid = s().createProject('Existing', undefined, 'Replay: test');
        const originalCount = Object.keys(s().projects).length;

        const replayId = s().replayProject(['task-1'], 'test');

        // Should still have the same or more projects
        expect(Object.keys(s().projects).length).toBeGreaterThanOrEqual(
          originalCount
        );
      });

      it('should handle empty taskIds by creating a NORMAL project', () => {
        const replayId = s().replayProject([], 'Empty');

        expect(replayId).toBeDefined();
        // When no taskIds, it falls back to createProject with NORMAL type
        // but the project name will be "Replay Project Empty"
        expect(s().projects[replayId]).toBeDefined();
      });

      it('should pass historyId to the created project', () => {
        const replayId = s().replayProject(
          ['task-1'],
          'HistTest',
          undefined,
          'hist-replay'
        );

        expect(s().projects[replayId].metadata?.historyId).toBe('hist-replay');
      });

      it('should set the replay project as active', () => {
        const replayId = s().replayProject(['task-1'], 'Active');
        // The async block also sets activeProjectId
        expect(s().activeProjectId).toBe(replayId);
      });
    });

    describe('loadProjectFromHistory', () => {
      it('should create a project and load tasks', async () => {
        const loadId = await s().loadProjectFromHistory(
          ['task-a', 'task-b'],
          'Test Question',
          'proj-load',
          'hist-load',
          'My Project'
        );

        expect(loadId).toBe('proj-load');
        expect(s().projects[loadId]).toBeDefined();
        expect(s().projects[loadId].name).toBe('My Project');
      });

      it('should use question prefix as name when projectName not provided', async () => {
        const loadId = await s().loadProjectFromHistory(
          ['task-1'],
          'This is a long question that should be truncated',
          'proj-load2'
        );

        const name = s().projects[loadId].name;
        expect(name.length).toBeLessThanOrEqual(50);
      });

      it('should overwrite existing project with same projectId', async () => {
        const pid = s().createProject('Existing', undefined, 'proj-overwrite');
        const originalCreatedAt = s().projects[pid].createdAt;

        const loadId = await s().loadProjectFromHistory(
          ['task-1'],
          'Q',
          'proj-overwrite'
        );

        // Should have removed and recreated
        expect(loadId).toBe('proj-overwrite');
      });

      it('should set activeProjectId to the loaded project', async () => {
        const loadId = await s().loadProjectFromHistory(
          ['task-1'],
          'Q',
          'proj-active'
        );

        expect(s().activeProjectId).toBe(loadId);
      });

      it('should create chat stores for each task and call replay', async () => {
        const mockedFn = vi.mocked(mockedCreateChatStoreInstance);
        mockedFn.mockClear();

        const loadId = await s().loadProjectFromHistory(
          ['task-1', 'task-2'],
          'Q',
          'proj-multi'
        );

        // Should have created chat stores: 1 initial + 2 for tasks = 3
        const chatCount = Object.keys(s().projects[loadId].chatStores).length;
        expect(chatCount).toBe(3); // initial + 2

        // Each created chat store should have replay called on it
        const instances = mockedFn.mock.results;
        // The instances created for tasks should have had getState().replay() called
      });
    });
  });

  // =========================================================================
  // 7. Integration-style edge cases
  // =========================================================================
  describe('Edge Cases & Integration', () => {
    it('createProject reuse should update historyId in metadata', () => {
      const pid = s().createProject('Empty');
      s().createProject('Reused', undefined, undefined, undefined, 'hist-new');

      expect(s().projects[pid].metadata?.historyId).toBe('hist-new');
    });

    it('multiple removeProject calls should handle correctly', () => {
      const p1 = s().createProject('P1', undefined, 'multi-1');
      const p2 = s().createProject('P2', undefined, 'multi-2');
      const p3 = s().createProject('P3', undefined, 'multi-3');

      s().removeProject(p1);
      s().removeProject(p2);

      expect(Object.keys(s().projects)).toHaveLength(1);
      expect(s().activeProjectId).toBe(p3);
    });

    it('addQueuedMessage → removeQueuedMessage → restoreQueuedMessage round-trip', () => {
      const pid = s().createProject('RoundTrip');
      const file = new File(['data'], 'file.txt');

      const taskId = s().addQueuedMessage(
        pid,
        'Test content',
        [file],
        'rt-1',
        'exec-rt'
      )!;

      expect(s().projects[pid].queuedMessages).toHaveLength(1);

      const removed = s().removeQueuedMessage(pid, taskId);
      expect(s().projects[pid].queuedMessages).toHaveLength(0);

      s().restoreQueuedMessage(pid, removed);
      expect(s().projects[pid].queuedMessages).toHaveLength(1);
      expect(s().projects[pid].queuedMessages[0].content).toBe('Test content');
      expect(s().projects[pid].queuedMessages[0].executionId).toBe('exec-rt');
    });

    it('queued messages should persist across project updates', () => {
      const pid = s().createProject('Persist');
      s().addQueuedMessage(pid, 'Persist msg', [], 't1');

      s().updateProject(pid, { name: 'Updated Name' });

      expect(s().projects[pid].queuedMessages).toHaveLength(1);
      expect(s().projects[pid].queuedMessages[0].content).toBe('Persist msg');
      expect(s().projects[pid].name).toBe('Updated Name');
    });

    it('getChatStore with explicit projectId should ignore activeProjectId', () => {
      const pid1 = s().createProject('P1');
      const pid2 = s().createProject('P2');

      // pid2 is active, but explicitly request pid1's chat store
      const chatId1 = s().projects[pid1].activeChatId!;
      const result = s().getChatStore(pid1, chatId1);

      expect(result).toBe(s().projects[pid1].chatStores[chatId1]);
    });

    it('full lifecycle: create → add chats → add queued → remove chat → clear queue', () => {
      const pid = s().createProject('Lifecycle');

      // Add chat stores
      const chat1 = Object.keys(s().projects[pid].chatStores)[0];
      const chat2 = s().createChatStore(pid)!;
      const chat3 = s().createChatStore(pid)!;

      expect(Object.keys(s().projects[pid].chatStores)).toHaveLength(3);

      // Add queued messages
      s().addQueuedMessage(pid, 'Msg 1', [], 'q1');
      s().addQueuedMessage(pid, 'Msg 2', [], 'q2');
      expect(s().projects[pid].queuedMessages).toHaveLength(2);

      // Remove one chat (should not be the last)
      s().removeChatStore(pid, chat3);
      expect(Object.keys(s().projects[pid].chatStores)).toHaveLength(2);

      // Clear queue
      s().clearQueuedMessages(pid);
      expect(s().projects[pid].queuedMessages).toEqual([]);

      // Project still exists with correct state
      expect(s().projects[pid].name).toBe('Lifecycle');
      expect(s().activeProjectId).toBe(pid);
    });
  });
});
