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
 * MessageHandler Tests
 *
 * Testes unitários para o módulo MessageHandler extraído do chatStore.
 */

import {
  addBulkMessages,
  addMessages,
  clearMessages,
  cloneMessage,
  createMessage,
  deleteMessage,
  findMessage,
  findMessageIndex,
  getAgentMessages,
  getAgentTaskMessages,
  getLastMessage,
  getMessageCount,
  getUserMessages,
  setMessages,
  updateMessage,
  upsertStreamingMessage,
  validateMessage,
} from '@/store/handlers/MessageHandler';
import type { Message, Task } from '@/types/chatbox';
import { describe, expect, it } from 'vitest';

// ============================================================================
// HELPERS
// ============================================================================

function createMockTask(overrides?: Partial<Task>): Task {
  return {
    messages: [],
    type: 'default',
    summaryTask: '',
    taskInfo: [],
    attaches: [],
    taskRunning: [],
    taskAssigning: [],
    fileList: [],
    webViewUrls: [],
    activeAsk: '',
    askList: [],
    progressValue: 0,
    isPending: false,
    activeWorkspace: null,
    hasMessages: false,
    activeAgent: '',
    status: 'pending' as const,
    taskTime: 0,
    elapsed: 0,
    tokens: 0,
    hasWaitComfirm: false,
    cotList: [],
    hasAddWorker: false,
    nuwFileNum: 0,
    delayTime: 0,
    selectedFile: null,
    snapshots: [],
    snapshotsTemp: [],
    isTakeControl: false,
    isTaskEdit: false,
    streamingDecomposeText: '',
    ...overrides,
  };
}

function createMockMessage(overrides?: Partial<Message>): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Test message',
    ...overrides,
  };
}

function createMockSet() {
  const state: { tasks: Record<string, Task> } = { tasks: {} };

  return {
    getState: () => state,
    set: (
      fn: (state: {
        tasks: Record<string, Task>;
      }) => Partial<{ tasks: Record<string, Task> }>
    ) => {
      const update = fn(state);
      if (update.tasks) {
        state.tasks = { ...state.tasks, ...update.tasks };
      }
    },
    state,
  };
}

// ============================================================================
// TESTS: Utilities
// ============================================================================

describe('MessageHandler - Utilities', () => {
  describe('validateMessage', () => {
    it('should return true for valid user message', () => {
      const message = createMockMessage({ role: 'user' });
      expect(validateMessage(message)).toBe(true);
    });

    it('should return true for valid agent message', () => {
      const message = createMockMessage({ role: 'agent' });
      expect(validateMessage(message)).toBe(true);
    });

    it('should return false for message without id', () => {
      const message = { role: 'user', content: 'test' } as Message;
      expect(validateMessage(message)).toBe(false);
    });

    it('should return false for message without role', () => {
      const message = { id: '123', content: 'test' } as Message;
      expect(validateMessage(message)).toBe(false);
    });

    it('should return false for message with invalid role', () => {
      const message = { id: '123', role: 'system', content: 'test' } as Message;
      expect(validateMessage(message)).toBe(false);
    });

    it('should return false for message without content', () => {
      const message = { id: '123', role: 'user' } as Message;
      expect(validateMessage(message)).toBe(false);
    });
  });

  describe('createMessage', () => {
    it('should create a user message with generated id', () => {
      const message = createMessage('Hello', 'user');
      expect(message.id).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
    });

    it('should create an agent message with generated id', () => {
      const message = createMessage('Hello', 'agent');
      expect(message.id).toBeDefined();
      expect(message.role).toBe('agent');
      expect(message.content).toBe('Hello');
    });

    it('should include extra properties', () => {
      const message = createMessage('Hello', 'user', { agent_id: 'agent-1' });
      expect(message.agent_id).toBe('agent-1');
    });
  });

  describe('cloneMessage', () => {
    it('should clone message with overrides', () => {
      const original = createMockMessage();
      const cloned = cloneMessage(original, { content: 'Updated content' });

      expect(cloned.id).toBe(original.id);
      expect(cloned.content).toBe('Updated content');
    });

    it('should allow changing id if specified', () => {
      const original = createMockMessage();
      const cloned = cloneMessage(original, { id: 'new-id' });
      expect(cloned.id).toBe('new-id');
    });
  });
});

// ============================================================================
// TESTS: Core Operations
// ============================================================================

describe('MessageHandler - Core Operations', () => {
  describe('addMessages', () => {
    it('should add a single message to task', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      const message = createMockMessage();
      const result = addMessages(set, 'task-1', message);

      expect(result.success).toBe(true);
      expect(state.tasks['task-1'].messages).toHaveLength(1);
      expect(state.tasks['task-1'].hasMessages).toBe(true);
    });

    it('should add multiple messages at once', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      const messages = [
        createMockMessage({ id: 'msg-1', content: 'First' }),
        createMockMessage({ id: 'msg-2', content: 'Second' }),
      ];
      const result = addMessages(set, 'task-1', messages);

      expect(result.success).toBe(true);
      expect(state.tasks['task-1'].messages).toHaveLength(2);
    });

    it('should return error for invalid message', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      const invalidMessage = { role: 'user' } as Message;
      const result = addMessages(set, 'task-1', invalidMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error for non-existent task', () => {
      const { set } = createMockSet();
      const message = createMockMessage();
      const result = addMessages(set, 'non-existent', message);

      expect(result.success).toBe(false);
    });
  });

  describe('updateMessage', () => {
    it('should update existing message', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage({ id: 'msg-1', content: 'Original' })],
      });
      state.tasks['task-1'] = task;

      const result = updateMessage(set, 'task-1', 'msg-1', {
        content: 'Updated',
      });

      expect(result.success).toBe(true);
      expect(state.tasks['task-1'].messages[0].content).toBe('Updated');
    });

    it('should return error for non-existent message', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      const result = updateMessage(set, 'task-1', 'non-existent', {
        content: 'Updated',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('setMessages', () => {
    it('should replace all messages', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage()],
      });
      state.tasks['task-1'] = task;

      const newMessages = [
        createMockMessage({ id: 'new-1', content: 'New 1' }),
        createMockMessage({ id: 'new-2', content: 'New 2' }),
      ];
      const result = setMessages(set, 'task-1', newMessages);

      expect(result.success).toBe(true);
      expect(state.tasks['task-1'].messages).toHaveLength(2);
      expect(state.tasks['task-1'].messages[0].content).toBe('New 1');
    });

    it('should set hasMessages to false for empty array', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({ hasMessages: true });
      state.tasks['task-1'] = task;

      setMessages(set, 'task-1', []);
      expect(state.tasks['task-1'].hasMessages).toBe(false);
    });
  });

  describe('deleteMessage', () => {
    it('should remove message by id', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [
          createMockMessage({ id: 'msg-1' }),
          createMockMessage({ id: 'msg-2' }),
        ],
      });
      state.tasks['task-1'] = task;

      const result = deleteMessage(set, 'task-1', 'msg-1');

      expect(result.success).toBe(true);
      expect(state.tasks['task-1'].messages).toHaveLength(1);
      expect(state.tasks['task-1'].messages[0].id).toBe('msg-2');
    });
  });
});

// ============================================================================
// TESTS: Query Operations
// ============================================================================

describe('MessageHandler - Query Operations', () => {
  const task = createMockTask({
    messages: [
      createMockMessage({
        id: 'msg-1',
        role: 'user',
        content: 'User message',
        agent_id: 'agent-1',
      }),
      createMockMessage({
        id: 'msg-2',
        role: 'agent',
        content: 'Agent response',
        agent_id: 'agent-1',
      }),
      createMockMessage({
        id: 'msg-3',
        role: 'user',
        content: 'Another user',
        agent_id: 'agent-2',
      }),
      createMockMessage({
        id: 'msg-4',
        role: 'agent',
        content: 'Another agent',
        agent_id: 'agent-2',
      }),
    ],
  });

  describe('findMessage', () => {
    it('should find message by id', () => {
      const found = findMessage(task, 'msg-1');
      expect(found).toBeDefined();
      expect(found?.content).toBe('User message');
    });

    it('should return undefined for non-existent id', () => {
      const found = findMessage(task, 'non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('findMessageIndex', () => {
    it('should return correct index', () => {
      expect(findMessageIndex(task, 'msg-1')).toBe(0);
      expect(findMessageIndex(task, 'msg-3')).toBe(2);
    });

    it('should return -1 for non-existent', () => {
      expect(findMessageIndex(task, 'non-existent')).toBe(-1);
    });
  });

  describe('getLastMessage', () => {
    it('should return last message', () => {
      const last = getLastMessage(task);
      expect(last?.id).toBe('msg-4');
    });

    it('should return undefined for empty task', () => {
      const emptyTask = createMockTask();
      const last = getLastMessage(emptyTask);
      expect(last).toBeUndefined();
    });
  });

  describe('getAgentMessages', () => {
    it('should return messages for specific agent', () => {
      const messages = getAgentMessages(task, 'agent-1');
      expect(messages).toHaveLength(2);
    });

    it('should return empty array for non-existent agent', () => {
      const messages = getAgentMessages(task, 'non-existent');
      expect(messages).toHaveLength(0);
    });
  });

  describe('getUserMessages', () => {
    it('should return only user messages', () => {
      const messages = getUserMessages(task);
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.role === 'user')).toBe(true);
    });
  });

  describe('getAgentTaskMessages', () => {
    it('should return only agent messages', () => {
      const messages = getAgentTaskMessages(task);
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.role === 'agent')).toBe(true);
    });
  });

  describe('getMessageCount', () => {
    it('should return correct count', () => {
      expect(getMessageCount(task)).toBe(4);
    });

    it('should return 0 for empty task', () => {
      const emptyTask = createMockTask();
      expect(getMessageCount(emptyTask)).toBe(0);
    });
  });
});

// ============================================================================
// TESTS: Bulk Operations
// ============================================================================

describe('MessageHandler - Bulk Operations', () => {
  describe('clearMessages', () => {
    it('should clear all messages', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage(), createMockMessage()],
        hasMessages: true,
      });
      state.tasks['task-1'] = task;

      clearMessages(set, 'task-1');

      expect(state.tasks['task-1'].messages).toHaveLength(0);
      expect(state.tasks['task-1'].hasMessages).toBe(false);
    });
  });

  describe('addBulkMessages', () => {
    it('should prepend messages when option is set', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage({ id: 'existing' })],
      });
      state.tasks['task-1'] = task;

      const newMessages = [
        createMockMessage({ id: 'new-1' }),
        createMockMessage({ id: 'new-2' }),
      ];
      addBulkMessages(set, 'task-1', newMessages, { prepend: true });

      expect(state.tasks['task-1'].messages[0].id).toBe('new-1');
    });

    it('should append messages by default', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage({ id: 'existing' })],
      });
      state.tasks['task-1'] = task;

      const newMessages = [createMockMessage({ id: 'new-1' })];
      addBulkMessages(set, 'task-1', newMessages);

      expect(state.tasks['task-1'].messages[1].id).toBe('new-1');
    });

    it('should filter duplicates when unique option is set', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [createMockMessage({ id: 'existing' })],
      });
      state.tasks['task-1'] = task;

      const newMessages = [
        createMockMessage({ id: 'existing' }), // duplicate
        createMockMessage({ id: 'new-1' }),
      ];
      addBulkMessages(set, 'task-1', newMessages, { unique: true });

      expect(state.tasks['task-1'].messages).toHaveLength(2);
    });
  });
});

// ============================================================================
// TESTS: Streaming Helpers
// ============================================================================

describe('MessageHandler - Streaming Helpers', () => {
  describe('upsertStreamingMessage', () => {
    it('should create new streaming message', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      upsertStreamingMessage(
        set,
        'task-1',
        'streaming-1',
        'Partial response...'
      );

      expect(state.tasks['task-1'].messages).toHaveLength(1);
      expect(state.tasks['task-1'].messages[0].id).toBe('streaming-1');
      expect(state.tasks['task-1'].messages[0].content).toBe(
        'Partial response...'
      );
      expect(state.tasks['task-1'].messages[0].role).toBe('agent');
    });

    it('should update existing streaming message', () => {
      const { set, state } = createMockSet();
      const task = createMockTask({
        messages: [
          createMockMessage({
            id: 'streaming-1',
            content: 'Partial...',
            role: 'agent',
          }),
        ],
      });
      state.tasks['task-1'] = task;

      upsertStreamingMessage(
        set,
        'task-1',
        'streaming-1',
        'Updated partial...'
      );

      expect(state.tasks['task-1'].messages).toHaveLength(1);
      expect(state.tasks['task-1'].messages[0].content).toBe(
        'Updated partial...'
      );
    });

    it('should include extras when creating', () => {
      const { set, state } = createMockSet();
      const task = createMockTask();
      state.tasks['task-1'] = task;

      upsertStreamingMessage(set, 'task-1', 'streaming-1', 'Response', {
        agent_id: 'agent-1',
      });

      expect(state.tasks['task-1'].messages[0].agent_id).toBe('agent-1');
    });
  });
});

// ============================================================================
// TESTS: Edge Cases
// ============================================================================

describe('MessageHandler - Edge Cases', () => {
  it('should handle empty task id', () => {
    const { set, state } = createMockSet();
    const task = createMockTask();
    state.tasks[''] = task;

    const message = createMockMessage();
    const result = addMessages(set, '', message);

    // Should not crash
    expect(result).toBeDefined();
  });

  it('should handle unicode content', () => {
    const { set, state } = createMockSet();
    const task = createMockTask();
    state.tasks['task-1'] = task;

    const message = createMockMessage({ content: '你好世界 🌍 🎉' });
    const result = addMessages(set, 'task-1', message);

    expect(result.success).toBe(true);
    expect(state.tasks['task-1'].messages[0].content).toBe('你好世界 🌍 🎉');
  });

  it('should handle very long content', () => {
    const { set, state } = createMockSet();
    const task = createMockTask();
    state.tasks['task-1'] = task;

    const longContent = 'a'.repeat(100000);
    const message = createMockMessage({ content: longContent });
    const result = addMessages(set, 'task-1', message);

    expect(result.success).toBe(true);
    expect(state.tasks['task-1'].messages[0].content).toHaveLength(100000);
  });

  it('should handle special characters in content', () => {
    const { set, state } = createMockSet();
    const task = createMockTask();
    state.tasks['task-1'] = task;

    const message = createMockMessage({
      content: '<script>alert("xss")</script> & "quotes"',
    });
    const result = addMessages(set, 'task-1', message);

    expect(result.success).toBe(true);
    // Content should be stored as-is (sanitization is caller responsibility)
    expect(state.tasks['task-1'].messages[0].content).toContain('<script>');
  });
});
