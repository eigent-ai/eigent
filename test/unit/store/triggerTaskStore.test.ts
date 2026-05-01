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
 * TriggerTaskStore Unit Tests
 *
 * Tests execution mapping management and message formatting:
 * - Execution mapping registration, retrieval, and removal
 * - formatTriggeredTaskMessage for schedule triggers
 * - formatTriggeredTaskMessage for webhook triggers (various input data)
 * - formatTriggeredTaskMessage for slack_trigger events
 */

import { TriggerType } from '@/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatTriggeredTaskMessage,
  useTriggerTaskStore,
  type TriggeredTask,
} from '../../../src/store/triggerTaskStore';

/** Factory to create a minimal TriggeredTask for testing. */
function createMockTask(overrides: Partial<TriggeredTask> = {}): TriggeredTask {
  return {
    id: 'task-1',
    triggerId: 1,
    triggerName: 'Test Trigger',
    taskPrompt: 'Run this task',
    executionId: 'exec-1',
    triggerType: TriggerType.Webhook,
    projectId: 'proj-1',
    inputData: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Store Tests
// ═══════════════════════════════════════════════════════════════════════

describe('TriggerTaskStore', () => {
  beforeEach(() => {
    useTriggerTaskStore.setState({
      executionMappings: new Map(),
    });
  });

  describe('Initial State', () => {
    it('should have an empty executionMappings Map', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      expect(result.current.executionMappings.size).toBe(0);
    });
  });

  describe('registerExecutionMapping', () => {
    it('should register a new mapping', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-1',
          'trigger-task-1',
          'proj-1'
        );
      });

      const mapping = result.current.executionMappings.get('chat-1');
      expect(mapping).toBeDefined();
      expect(mapping!.chatTaskId).toBe('chat-1');
      expect(mapping!.executionId).toBe('exec-1');
      expect(mapping!.triggerTaskId).toBe('trigger-task-1');
      expect(mapping!.projectId).toBe('proj-1');
      expect(mapping!.reported).toBe(false);
    });

    it('should register multiple mappings', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-1',
          'tt-1',
          'proj-1'
        );
        result.current.registerExecutionMapping(
          'chat-2',
          'exec-2',
          'tt-2',
          'proj-2'
        );
      });

      expect(result.current.executionMappings.size).toBe(2);
    });

    it('should overwrite an existing mapping with the same chatTaskId', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-old',
          'tt-old',
          'proj-1'
        );
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-new',
          'tt-new',
          'proj-2'
        );
      });

      expect(result.current.executionMappings.size).toBe(1);
      const mapping = result.current.executionMappings.get('chat-1');
      expect(mapping!.executionId).toBe('exec-new');
    });
  });

  describe('getExecutionMapping', () => {
    it('should return the mapping for a registered chatTaskId', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-42',
          'exec-x',
          'tt-x',
          'proj-x'
        );
      });

      const mapping = result.current.getExecutionMapping('chat-42');

      expect(mapping).toBeDefined();
      expect(mapping!.chatTaskId).toBe('chat-42');
      expect(mapping!.executionId).toBe('exec-x');
    });

    it('should return undefined for an unregistered chatTaskId', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      const mapping = result.current.getExecutionMapping('nonexistent');

      expect(mapping).toBeUndefined();
    });

    it('should return undefined after the mapping is removed', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-1',
          'tt-1',
          'proj-1'
        );
        result.current.removeExecutionMapping('chat-1');
      });

      const mapping = result.current.getExecutionMapping('chat-1');

      expect(mapping).toBeUndefined();
    });
  });

  describe('removeExecutionMapping', () => {
    it('should remove an existing mapping', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-1',
          'tt-1',
          'proj-1'
        );
        result.current.registerExecutionMapping(
          'chat-2',
          'exec-2',
          'tt-2',
          'proj-2'
        );
      });

      act(() => {
        result.current.removeExecutionMapping('chat-1');
      });

      expect(result.current.executionMappings.size).toBe(1);
      expect(result.current.executionMappings.has('chat-1')).toBe(false);
      expect(result.current.executionMappings.has('chat-2')).toBe(true);
    });

    it('should be a no-op when chatTaskId does not exist', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.registerExecutionMapping(
          'chat-1',
          'exec-1',
          'tt-1',
          'proj-1'
        );
        result.current.removeExecutionMapping('nonexistent');
      });

      expect(result.current.executionMappings.size).toBe(1);
    });

    it('should handle removing from an empty Map', () => {
      const { result } = renderHook(() => useTriggerTaskStore());

      act(() => {
        result.current.removeExecutionMapping('anything');
      });

      expect(result.current.executionMappings.size).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// formatTriggeredTaskMessage Tests
// ═══════════════════════════════════════════════════════════════════════

describe('formatTriggeredTaskMessage', () => {
  // ─── Schedule triggers ──────────────────────────────────────────

  describe('schedule trigger', () => {
    it('should return just the taskPrompt for scheduled triggers', () => {
      const task = createMockTask({
        triggerType: TriggerType.Schedule,
        inputData: {},
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toBe('Run this task');
    });

    it('should ignore inputData for schedule triggers', () => {
      const task = createMockTask({
        triggerType: TriggerType.Schedule,
        inputData: { some: 'data' },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toBe('Run this task');
      expect(result).not.toContain('Trigger Context');
    });
  });

  // ─── Webhook triggers ───────────────────────────────────────────

  describe('webhook trigger with empty inputData', () => {
    it('should return just the taskPrompt when inputData is empty', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: {},
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toBe('Run this task');
    });
  });

  describe('webhook trigger with no method/query/body/headers', () => {
    it('should return just the taskPrompt when inputData has no webhook-relevant fields', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: { irrelevant_field: 'value' },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toBe('Run this task');
    });
  });

  describe('webhook trigger with method', () => {
    it('should add Method line', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: { method: 'POST' },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('Run this task');
      expect(result).toContain('**Source:** Webhook trigger');
      expect(result).toContain('**Method:** POST');
    });
  });

  describe('webhook trigger with query params', () => {
    it('should add Query Parameters line', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: { query: { page: 1, limit: 10 } },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Query Parameters:**');
      expect(result).toContain('"page":1');
      expect(result).toContain('"limit":10');
    });
  });

  describe('webhook trigger with body', () => {
    it('should add Request Body in JSON code block', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: { body: { name: 'test', value: 42 } },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Request Body:**');
      expect(result).toContain('```json');
      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 42');
      expect(result).toContain('```');
    });
  });

  describe('webhook trigger with headers', () => {
    it('should add Headers line but remove authorization and cookie', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        triggerName: 'MyHook',
        inputData: {
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret-token',
            cookie: 'session=abc123',
            'x-custom': 'value',
          },
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Headers:**');
      expect(result).toContain('"content-type":"application/json"');
      expect(result).toContain('"x-custom":"value"');
      expect(result).not.toContain('authorization');
      expect(result).not.toContain('Bearer');
      expect(result).not.toContain('cookie');
      expect(result).not.toContain('session=');
    });

    it('should not add Headers section when only sensitive headers exist', () => {
      const task = createMockTask({
        triggerType: TriggerType.Webhook,
        inputData: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'session=xyz',
          },
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).not.toContain('**Headers:**');
    });
  });

  // ─── Slack trigger ──────────────────────────────────────────────

  describe('slack_trigger', () => {
    it('should add event_type, text, channel_id, user_id', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        triggerName: 'Slack Bot',
        inputData: {
          event_type: 'message',
          text: 'Hello world',
          channel_id: 'C12345',
          user_id: 'U67890',
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Source:** Slack trigger "Slack Bot"');
      expect(result).toContain('**Event Type:** message');
      expect(result).toContain('**Message:** Hello world');
      expect(result).toContain('**Channel ID:** C12345');
      expect(result).toContain('**Sender User ID:** U67890');
    });

    it('should add thread_ts, message_ts, team_id', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        inputData: {
          thread_ts: '1234567890.123456',
          message_ts: '1234567890.789012',
          team_id: 'T99999',
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Thread TS:** 1234567890.123456');
      expect(result).toContain('**Message TS:** 1234567890.789012');
      expect(result).toContain('**Team ID:** T99999');
    });

    it('should add reaction with colon wrapping', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        inputData: {
          reaction: 'thumbsup',
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Reaction:** :thumbsup:');
    });

    it('should add files count when files are present', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        inputData: {
          files: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Files:** 3 file(s) attached');
    });

    it('should not add Files line when files array is empty', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        inputData: {
          files: [],
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).not.toContain('**Files:**');
    });

    it('should include all Slack fields in a full event', () => {
      const task = createMockTask({
        triggerType: TriggerType.Slack,
        triggerName: 'Full Slack',
        inputData: {
          event_type: 'app_mention',
          text: 'Hey bot',
          channel_id: 'C111',
          user_id: 'U222',
          thread_ts: '111.222',
          message_ts: '333.444',
          team_id: 'T555',
          reaction: 'wave',
          files: [{ id: 'f1' }],
        },
      });

      const result = formatTriggeredTaskMessage(task);

      expect(result).toContain('**Source:** Slack trigger "Full Slack"');
      expect(result).toContain('**Event Type:** app_mention');
      expect(result).toContain('**Message:** Hey bot');
      expect(result).toContain('**Channel ID:** C111');
      expect(result).toContain('**Sender User ID:** U222');
      expect(result).toContain('**Thread TS:** 111.222');
      expect(result).toContain('**Message TS:** 333.444');
      expect(result).toContain('**Team ID:** T555');
      expect(result).toContain('**Reaction:** :wave:');
      expect(result).toContain('**Files:** 1 file(s) attached');
    });
  });
});
