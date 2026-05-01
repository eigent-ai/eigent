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
 * TriggerStore Unit Tests
 *
 * Tests trigger management and WebSocket state:
 * - Initial state defaults
 * - Trigger CRUD operations (add, update, delete, duplicate, getById)
 * - WebSocket connection status management
 * - WebSocket event emission and clearing
 * - Reconnect callback management
 */

import { TriggerStatus, TriggerType } from '@/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useTriggerStore,
  type WebSocketEvent,
} from '../../../src/store/triggerStore';

/** Factory to create a minimal valid trigger for testing. */
function createMockTrigger(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    user_id: 'user-1',
    name: 'Test Trigger',
    description: 'A test trigger',
    trigger_type: TriggerType.Webhook,
    status: TriggerStatus.Active,
    is_single_execution: false,
    ...overrides,
  };
}

describe('TriggerStore', () => {
  beforeEach(() => {
    useTriggerStore.setState({
      triggers: [],
      webSocketEvent: null,
      wsConnectionStatus: 'disconnected',
      lastPongTimestamp: null,
      wsReconnectCallback: null,
    });
  });

  // ─── Initial State ────────────────────────────────────────────────

  describe('Initial State', () => {
    it('should have empty triggers array', () => {
      const { result } = renderHook(() => useTriggerStore());

      expect(result.current.triggers).toEqual([]);
    });

    it('should have null webSocketEvent', () => {
      const { result } = renderHook(() => useTriggerStore());

      expect(result.current.webSocketEvent).toBeNull();
    });

    it('should have wsConnectionStatus "disconnected"', () => {
      const { result } = renderHook(() => useTriggerStore());

      expect(result.current.wsConnectionStatus).toBe('disconnected');
    });

    it('should have null lastPongTimestamp', () => {
      const { result } = renderHook(() => useTriggerStore());

      expect(result.current.lastPongTimestamp).toBeNull();
    });

    it('should have null wsReconnectCallback', () => {
      const { result } = renderHook(() => useTriggerStore());

      expect(result.current.wsReconnectCallback).toBeNull();
    });
  });

  // ─── setTriggers ──────────────────────────────────────────────────

  describe('setTriggers', () => {
    it('should replace the triggers array with provided triggers', () => {
      const { result } = renderHook(() => useTriggerStore());

      const triggers = [
        createMockTrigger({ id: 1, name: 'Trigger A' }),
        createMockTrigger({ id: 2, name: 'Trigger B' }),
      ];

      act(() => {
        result.current.setTriggers(triggers);
      });

      expect(result.current.triggers).toEqual(triggers);
      expect(result.current.triggers).toHaveLength(2);
    });

    it('should set triggers to empty array', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.setTriggers([createMockTrigger({ id: 1 })]);
      });

      act(() => {
        result.current.setTriggers([]);
      });

      expect(result.current.triggers).toEqual([]);
    });
  });

  // ─── setWsConnectionStatus ────────────────────────────────────────

  describe('setWsConnectionStatus', () => {
    it.each(['disconnected', 'connecting', 'connected', 'unhealthy'] as const)(
      'should set wsConnectionStatus to "%s"',
      (status) => {
        const { result } = renderHook(() => useTriggerStore());

        act(() => {
          result.current.setWsConnectionStatus(status);
        });

        expect(result.current.wsConnectionStatus).toBe(status);
      }
    );
  });

  // ─── setLastPongTimestamp ─────────────────────────────────────────

  describe('setLastPongTimestamp', () => {
    it('should set the lastPongTimestamp to a number', () => {
      const { result } = renderHook(() => useTriggerStore());

      const ts = Date.now();
      act(() => {
        result.current.setLastPongTimestamp(ts);
      });

      expect(result.current.lastPongTimestamp).toBe(ts);
    });

    it('should set the lastPongTimestamp to null', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.setLastPongTimestamp(Date.now());
      });

      act(() => {
        result.current.setLastPongTimestamp(null);
      });

      expect(result.current.lastPongTimestamp).toBeNull();
    });
  });

  // ─── setWsReconnectCallback & triggerReconnect ───────────────────

  describe('setWsReconnectCallback', () => {
    it('should store a callback function', () => {
      const { result } = renderHook(() => useTriggerStore());
      const cb = vi.fn();

      act(() => {
        result.current.setWsReconnectCallback(cb);
      });

      expect(result.current.wsReconnectCallback).toBe(cb);
    });

    it('should set callback to null', () => {
      const { result } = renderHook(() => useTriggerStore());
      const cb = vi.fn();

      act(() => {
        result.current.setWsReconnectCallback(cb);
      });

      act(() => {
        result.current.setWsReconnectCallback(null);
      });

      expect(result.current.wsReconnectCallback).toBeNull();
    });
  });

  describe('triggerReconnect', () => {
    it('should call the stored reconnect callback', () => {
      const { result } = renderHook(() => useTriggerStore());
      const cb = vi.fn();

      act(() => {
        result.current.setWsReconnectCallback(cb);
      });

      act(() => {
        result.current.triggerReconnect();
      });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when callback is null', () => {
      const { result } = renderHook(() => useTriggerStore());

      // Should not throw
      act(() => {
        result.current.triggerReconnect();
      });
    });
  });

  // ─── addTrigger ───────────────────────────────────────────────────

  describe('addTrigger', () => {
    it('should add a trigger to the empty triggers array', () => {
      const { result } = renderHook(() => useTriggerStore());

      const data = createMockTrigger({ id: 10, name: 'New Trigger' });

      let returned: any;
      act(() => {
        returned = result.current.addTrigger(data);
      });

      expect(result.current.triggers).toHaveLength(1);
      expect(result.current.triggers[0]).toEqual(data);
      expect(returned).toEqual(data);
    });

    it('should append a trigger to existing triggers', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
      });

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 2, name: 'Second' }));
      });

      expect(result.current.triggers).toHaveLength(2);
      expect(result.current.triggers[1].id).toBe(2);
    });

    it('should return the newly created trigger', () => {
      const { result } = renderHook(() => useTriggerStore());

      const data = createMockTrigger({ id: 99, name: 'Return Test' });

      let returned: any;
      act(() => {
        returned = result.current.addTrigger(data);
      });

      expect(returned.id).toBe(99);
      expect(returned.name).toBe('Return Test');
    });
  });

  // ─── updateTrigger ────────────────────────────────────────────────

  describe('updateTrigger', () => {
    it('should update a trigger by id with merged data', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(
          createMockTrigger({ id: 1, name: 'Original' })
        );
      });

      act(() => {
        result.current.updateTrigger(1, { name: 'Updated' });
      });

      expect(result.current.triggers[0].name).toBe('Updated');
    });

    it('should set updated_at to an ISO string on update', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
      });

      const beforeUpdate = new Date().toISOString();

      act(() => {
        result.current.updateTrigger(1, { name: 'Updated' });
      });

      const updated_at = result.current.triggers[0].updated_at;
      expect(typeof updated_at).toBe('string');
      // Should be a valid ISO date string
      expect(new Date(updated_at!).getTime()).not.toBeNaN();
    });

    it('should not modify other triggers when updating one', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(
          createMockTrigger({ id: 1, name: 'Trigger A' })
        );
        result.current.addTrigger(
          createMockTrigger({ id: 2, name: 'Trigger B' })
        );
      });

      act(() => {
        result.current.updateTrigger(1, { name: 'Updated A' });
      });

      expect(result.current.triggers[0].name).toBe('Updated A');
      expect(result.current.triggers[1].name).toBe('Trigger B');
    });

    it('should leave triggers unchanged when id does not match', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(
          createMockTrigger({ id: 1, name: 'Only Trigger' })
        );
      });

      act(() => {
        result.current.updateTrigger(999, { name: 'Ghost Update' });
      });

      expect(result.current.triggers).toHaveLength(1);
      expect(result.current.triggers[0].name).toBe('Only Trigger');
    });
  });

  // ─── deleteTrigger ────────────────────────────────────────────────

  describe('deleteTrigger', () => {
    it('should remove a trigger by id', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
        result.current.addTrigger(createMockTrigger({ id: 2 }));
      });

      act(() => {
        result.current.deleteTrigger(1);
      });

      expect(result.current.triggers).toHaveLength(1);
      expect(result.current.triggers[0].id).toBe(2);
    });

    it('should leave triggers unchanged when id does not exist', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
      });

      act(() => {
        result.current.deleteTrigger(999);
      });

      expect(result.current.triggers).toHaveLength(1);
    });

    it('should handle deleting from an empty triggers array', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.deleteTrigger(1);
      });

      expect(result.current.triggers).toEqual([]);
    });
  });

  // ─── duplicateTrigger ─────────────────────────────────────────────

  describe('duplicateTrigger', () => {
    it('should append a copy of the trigger to the array', () => {
      const { result } = renderHook(() => useTriggerStore());
      const original = createMockTrigger({ id: 1, name: 'Original' });

      act(() => {
        result.current.addTrigger(original);
      });

      act(() => {
        result.current.duplicateTrigger(1);
      });

      expect(result.current.triggers).toHaveLength(2);
      // The duplicate is a copy of the original object
      expect(result.current.triggers[1]).toEqual(original);
    });

    it('should return the duplicated trigger', () => {
      const { result } = renderHook(() => useTriggerStore());
      const original = createMockTrigger({ id: 5, name: 'Dupa' });

      act(() => {
        result.current.addTrigger(original);
      });

      let returned: any;
      act(() => {
        returned = result.current.duplicateTrigger(5);
      });

      expect(returned).toEqual(original);
    });

    it('should return null when trigger id is not found', () => {
      const { result } = renderHook(() => useTriggerStore());

      let returned: any;
      act(() => {
        returned = result.current.duplicateTrigger(999);
      });

      expect(returned).toBeNull();
    });

    it('should not modify the array when trigger is not found', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
      });

      act(() => {
        result.current.duplicateTrigger(999);
      });

      expect(result.current.triggers).toHaveLength(1);
    });
  });

  // ─── getTriggerById ───────────────────────────────────────────────

  describe('getTriggerById', () => {
    it('should return the trigger with matching id', () => {
      const { result } = renderHook(() => useTriggerStore());
      const trigger = createMockTrigger({ id: 42, name: 'Find Me' });

      act(() => {
        result.current.addTrigger(trigger);
      });

      const found = result.current.getTriggerById(42);

      expect(found).toBeDefined();
      expect(found!.name).toBe('Find Me');
    });

    it('should return undefined when no trigger matches', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.addTrigger(createMockTrigger({ id: 1 }));
      });

      const found = result.current.getTriggerById(999);

      expect(found).toBeUndefined();
    });

    it('should return undefined on an empty triggers array', () => {
      const { result } = renderHook(() => useTriggerStore());

      const found = result.current.getTriggerById(1);

      expect(found).toBeUndefined();
    });
  });

  // ─── emitWebSocketEvent ───────────────────────────────────────────

  describe('emitWebSocketEvent', () => {
    it('should set the webSocketEvent', () => {
      const { result } = renderHook(() => useTriggerStore());

      const event: WebSocketEvent = {
        triggerId: 1,
        triggerName: 'Webhook Trigger',
        taskPrompt: 'Do something',
        executionId: 'exec-123',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: 'proj-1',
        inputData: {},
      };

      act(() => {
        result.current.emitWebSocketEvent(event);
      });

      expect(result.current.webSocketEvent).toEqual(event);
    });

    it('should replace the previous event when called again', () => {
      const { result } = renderHook(() => useTriggerStore());

      const event1: WebSocketEvent = {
        triggerId: 1,
        triggerName: 'First',
        taskPrompt: 'Task 1',
        executionId: 'exec-1',
        timestamp: Date.now(),
        triggerType: TriggerType.Webhook,
        projectId: null,
        inputData: {},
      };

      const event2: WebSocketEvent = {
        triggerId: 2,
        triggerName: 'Second',
        taskPrompt: 'Task 2',
        executionId: 'exec-2',
        timestamp: Date.now(),
        triggerType: TriggerType.Schedule,
        projectId: 'proj-2',
        inputData: {},
      };

      act(() => {
        result.current.emitWebSocketEvent(event1);
      });

      act(() => {
        result.current.emitWebSocketEvent(event2);
      });

      expect(result.current.webSocketEvent).toEqual(event2);
    });
  });

  // ─── clearWebSocketEvent ──────────────────────────────────────────

  describe('clearWebSocketEvent', () => {
    it('should set webSocketEvent to null', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.emitWebSocketEvent({
          triggerId: 1,
          triggerName: 'Test',
          taskPrompt: 'Test',
          executionId: 'exec-1',
          timestamp: Date.now(),
          triggerType: TriggerType.Webhook,
          projectId: null,
          inputData: {},
        });
      });

      act(() => {
        result.current.clearWebSocketEvent();
      });

      expect(result.current.webSocketEvent).toBeNull();
    });

    it('should remain null when called with no active event', () => {
      const { result } = renderHook(() => useTriggerStore());

      act(() => {
        result.current.clearWebSocketEvent();
      });

      expect(result.current.webSocketEvent).toBeNull();
    });
  });
});
