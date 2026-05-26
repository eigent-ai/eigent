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
 * ActivityLogStore Unit Tests
 *
 * Tests activity log management:
 * - Initial state defaults
 * - addLog with auto-generated id and timestamp, prepending, and 100-log cap
 * - modifyLog by executionId with metadata merging
 * - clearLogs
 * - clearLogsForProject
 * - getRecentLogs
 * - getLogsForProject
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityType,
  useActivityLogStore,
} from '../../../src/store/activityLogStore';

/** Factory to create a log entry payload (omit id and timestamp). */
function createLogPayload(overrides: Record<string, any> = {}) {
  return {
    type: ActivityType.TriggerExecuted,
    message: 'Test log message',
    executionId: `exec-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    triggerId: 1,
    triggerName: 'Test Trigger',
    ...overrides,
  };
}

describe('ActivityLogStore', () => {
  beforeEach(() => {
    useActivityLogStore.setState({ logs: [] });
  });

  // ─── Initial State ────────────────────────────────────────────────

  describe('Initial State', () => {
    it('should have an empty logs array', () => {
      const { result } = renderHook(() => useActivityLogStore());

      expect(result.current.logs).toEqual([]);
    });
  });

  // ─── addLog ───────────────────────────────────────────────────────

  describe('addLog', () => {
    it('should add a log to an empty array', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(createLogPayload());
      });

      expect(result.current.logs).toHaveLength(1);
    });

    it('should auto-generate an id matching log_{timestamp}_{counter} pattern', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(createLogPayload());
      });

      const log = result.current.logs[0];
      expect(log.id).toMatch(/^log_\d+_\d+$/);
    });

    it('should auto-generate a timestamp as a Date instance', () => {
      const { result } = renderHook(() => useActivityLogStore());

      const before = new Date();
      act(() => {
        result.current.addLog(createLogPayload());
      });
      const after = new Date();

      const log = result.current.logs[0];
      expect(log.timestamp).toBeInstanceOf(Date);
      expect(log.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(log.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should prepend new logs to the beginning of the array', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(createLogPayload({ message: 'First' }));
        result.current.addLog(createLogPayload({ message: 'Second' }));
      });

      // Second was added last, so it should be first (prepend)
      expect(result.current.logs[0].message).toBe('Second');
      expect(result.current.logs[1].message).toBe('First');
    });

    it('should cap logs at 100 entries', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 150; i++) {
          result.current.addLog(
            createLogPayload({ message: `Log ${i}`, executionId: `exec-${i}` })
          );
        }
      });

      expect(result.current.logs).toHaveLength(100);
    });

    it('should keep the most recent logs when capped (first 100)', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 150; i++) {
          result.current.addLog(
            createLogPayload({ message: `Log ${i}`, executionId: `exec-${i}` })
          );
        }
      });

      // Most recent (Log 149) should be first
      expect(result.current.logs[0].message).toBe('Log 149');
      // Oldest kept (Log 50) should be last
      expect(result.current.logs[99].message).toBe('Log 50');
    });

    it('should preserve all provided fields on the log entry', () => {
      const { result } = renderHook(() => useActivityLogStore());

      const payload = createLogPayload({
        type: ActivityType.WebhookTriggered,
        message: 'Webhook fired',
        executionId: 'exec-special',
        projectId: 'proj-42',
        triggerId: 99,
        triggerName: 'Special Trigger',
        metadata: { key: 'value' },
      });

      act(() => {
        result.current.addLog(payload);
      });

      const log = result.current.logs[0];
      expect(log.type).toBe(ActivityType.WebhookTriggered);
      expect(log.message).toBe('Webhook fired');
      expect(log.executionId).toBe('exec-special');
      expect(log.projectId).toBe('proj-42');
      expect(log.triggerId).toBe(99);
      expect(log.triggerName).toBe('Special Trigger');
      expect(log.metadata).toEqual({ key: 'value' });
    });
  });

  // ─── modifyLog ────────────────────────────────────────────────────

  describe('modifyLog', () => {
    it('should update a log matching the executionId', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ executionId: 'exec-target', message: 'Original' })
        );
      });

      let success: boolean;
      act(() => {
        success = result.current.modifyLog('exec-target', {
          message: 'Updated',
        });
      });

      expect(success!).toBe(true);
      expect(result.current.logs[0].message).toBe('Updated');
    });

    it('should return false when no log matches the executionId', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ executionId: 'exec-existing' })
        );
      });

      let success: boolean;
      act(() => {
        success = result.current.modifyLog('exec-missing', {
          message: 'Nope',
        });
      });

      expect(success!).toBe(false);
    });

    it('should merge metadata with existing metadata', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({
            executionId: 'exec-meta',
            metadata: { key1: 'val1', key2: 'val2' },
          })
        );
      });

      act(() => {
        result.current.modifyLog('exec-meta', {
          metadata: { key2: 'updated', key3: 'new' },
        });
      });

      const log = result.current.logs[0];
      expect(log.metadata).toEqual({
        key1: 'val1',
        key2: 'updated',
        key3: 'new',
      });
    });

    it('should not modify other logs when updating one', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ executionId: 'exec-1', message: 'Log One' })
        );
        result.current.addLog(
          createLogPayload({ executionId: 'exec-2', message: 'Log Two' })
        );
      });

      act(() => {
        result.current.modifyLog('exec-1', { message: 'Updated One' });
      });

      expect(result.current.logs[1].message).toBe('Updated One');
      expect(result.current.logs[0].message).toBe('Log Two');
    });

    it('should preserve the original id and timestamp on modify', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ executionId: 'exec-preserve' })
        );
      });

      const originalId = result.current.logs[0].id;
      const originalTimestamp = result.current.logs[0].timestamp;

      act(() => {
        result.current.modifyLog('exec-preserve', { message: 'Changed' });
      });

      expect(result.current.logs[0].id).toBe(originalId);
      expect(result.current.logs[0].timestamp).toBe(originalTimestamp);
    });
  });

  // ─── clearLogs ────────────────────────────────────────────────────

  describe('clearLogs', () => {
    it('should remove all logs', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(createLogPayload());
        result.current.addLog(createLogPayload());
        result.current.addLog(createLogPayload());
      });

      expect(result.current.logs).toHaveLength(3);

      act(() => {
        result.current.clearLogs();
      });

      expect(result.current.logs).toEqual([]);
    });

    it('should handle clearing an already empty logs array', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.clearLogs();
      });

      expect(result.current.logs).toEqual([]);
    });
  });

  // ─── clearLogsForProject ──────────────────────────────────────────

  describe('clearLogsForProject', () => {
    it('should remove only logs matching the given projectId', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a1' })
        );
        result.current.addLog(
          createLogPayload({ projectId: 'proj-b', executionId: 'exec-b1' })
        );
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a2' })
        );
      });

      act(() => {
        result.current.clearLogsForProject('proj-a');
      });

      expect(result.current.logs).toHaveLength(1);
      expect(result.current.logs[0].executionId).toBe('exec-b1');
    });

    it('should leave logs unchanged when projectId has no matches', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a1' })
        );
      });

      act(() => {
        result.current.clearLogsForProject('proj-nonexistent');
      });

      expect(result.current.logs).toHaveLength(1);
    });

    it('should not remove logs without a projectId (undefined)', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        // Add a log without a projectId field
        result.current.addLog({
          type: ActivityType.TriggerExecuted,
          message: 'No project log',
          executionId: 'exec-no-proj',
        });
      });

      act(() => {
        result.current.clearLogsForProject('proj-a');
      });

      expect(result.current.logs).toHaveLength(1);
    });
  });

  // ─── getRecentLogs ────────────────────────────────────────────────

  describe('getRecentLogs', () => {
    it('should return the first N logs (most recent)', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.addLog(
            createLogPayload({
              message: `Log ${i}`,
              executionId: `exec-${i}`,
            })
          );
        }
      });

      const recent = result.current.getRecentLogs(5);

      expect(recent).toHaveLength(5);
      // Most recent first (Log 19 is the newest)
      expect(recent[0].message).toBe('Log 19');
      expect(recent[4].message).toBe('Log 15');
    });

    it('should default to 10 logs when no count is provided', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.addLog(
            createLogPayload({
              message: `Log ${i}`,
              executionId: `exec-${i}`,
            })
          );
        }
      });

      const recent = result.current.getRecentLogs();

      expect(recent).toHaveLength(10);
    });

    it('should return all logs when fewer than requested count', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(createLogPayload({ executionId: 'exec-1' }));
        result.current.addLog(createLogPayload({ executionId: 'exec-2' }));
      });

      const recent = result.current.getRecentLogs(10);

      expect(recent).toHaveLength(2);
    });

    it('should return empty array when no logs exist', () => {
      const { result } = renderHook(() => useActivityLogStore());

      const recent = result.current.getRecentLogs(5);

      expect(recent).toEqual([]);
    });
  });

  // ─── getLogsForProject ────────────────────────────────────────────

  describe('getLogsForProject', () => {
    it('should return only logs for the specified projectId', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a1' })
        );
        result.current.addLog(
          createLogPayload({ projectId: 'proj-b', executionId: 'exec-b1' })
        );
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a2' })
        );
      });

      const projectLogs = result.current.getLogsForProject('proj-a');

      expect(projectLogs).toHaveLength(2);
      expect(projectLogs.every((log) => log.projectId === 'proj-a')).toBe(true);
    });

    it('should respect the count parameter', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.addLog(
            createLogPayload({
              projectId: 'proj-a',
              executionId: `exec-${i}`,
            })
          );
        }
      });

      const projectLogs = result.current.getLogsForProject('proj-a', 3);

      expect(projectLogs).toHaveLength(3);
    });

    it('should default to 100 when no count is provided', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        for (let i = 0; i < 110; i++) {
          result.current.addLog(
            createLogPayload({
              projectId: 'proj-a',
              executionId: `exec-${i}`,
            })
          );
        }
      });

      const projectLogs = result.current.getLogsForProject('proj-a');

      expect(projectLogs).toHaveLength(100);
    });

    it('should return empty array when projectId has no logs', () => {
      const { result } = renderHook(() => useActivityLogStore());

      act(() => {
        result.current.addLog(
          createLogPayload({ projectId: 'proj-a', executionId: 'exec-a1' })
        );
      });

      const projectLogs = result.current.getLogsForProject('proj-nonexistent');

      expect(projectLogs).toEqual([]);
    });

    it('should return empty array when no logs exist at all', () => {
      const { result } = renderHook(() => useActivityLogStore());

      const projectLogs = result.current.getLogsForProject('proj-a');

      expect(projectLogs).toEqual([]);
    });
  });
});
