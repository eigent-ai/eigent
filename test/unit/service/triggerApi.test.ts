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
 * triggerApi Unit Tests
 *
 * Tests all exported proxy API functions:
 * - proxyFetchTriggers: query param building, proxyFetchGet delegation
 * - proxyFetchProjectTriggers: project_id guard, query params
 * - proxyFetchTrigger: single trigger fetch
 * - proxyFetchTriggerConfig: config fetch by trigger type
 * - proxyCreateTrigger: POST delegation
 * - proxyUpdateTrigger: PUT delegation
 * - proxyDeleteTrigger: DELETE delegation
 * - proxyActivateTrigger / proxyDeactivateTrigger: POST to sub-routes
 * - proxyFetchTriggerExecutions: paginated execution listing
 * - proxyUpdateTriggerExecution: PUT + activity log dispatching per status
 * - proxyRetryTriggerExecution: POST + activity log for retry
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (vi.hoisted ensures availability inside hoisted vi.mock factories) ──

const {
  mockProxyFetchGet,
  mockProxyFetchPost,
  mockProxyFetchPut,
  mockProxyFetchDelete,
  mockAddLog,
  mockModifyLog,
} = vi.hoisted(() => ({
  mockProxyFetchGet: vi.fn(),
  mockProxyFetchPost: vi.fn(),
  mockProxyFetchPut: vi.fn(),
  mockProxyFetchDelete: vi.fn(),
  mockAddLog: vi.fn(),
  mockModifyLog: vi.fn(() => false),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: mockProxyFetchGet,
  proxyFetchPost: mockProxyFetchPost,
  proxyFetchPut: mockProxyFetchPut,
  proxyFetchDelete: mockProxyFetchDelete,
}));

vi.mock('@/store/activityLogStore', () => ({
  useActivityLogStore: {
    getState: vi.fn(() => ({
      addLog: mockAddLog,
      modifyLog: mockModifyLog,
    })),
  },
  ActivityType: {
    TriggerCreated: 'trigger_created',
    TriggerExecuted: 'trigger_executed',
    ExecutionSuccess: 'execution_success',
    ExecutionFailed: 'execution_failed',
    ExecutionCancelled: 'execution_cancelled',
  },
}));

// ── Import after mocks ───────────────────────────────────────────────────

import {
  proxyActivateTrigger,
  proxyCreateTrigger,
  proxyDeactivateTrigger,
  proxyDeleteTrigger,
  proxyFetchProjectTriggers,
  proxyFetchTrigger,
  proxyFetchTriggerConfig,
  proxyFetchTriggerExecutions,
  proxyFetchTriggers,
  proxyRetryTriggerExecution,
  proxyUpdateTrigger,
  proxyUpdateTriggerExecution,
} from '@/service/triggerApi';
import { ExecutionStatus, TriggerStatus, TriggerType } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a minimal TriggerInput payload. */
function createTriggerInput(overrides: Record<string, any> = {}) {
  return {
    name: 'Test Trigger',
    trigger_type: TriggerType.Schedule,
    custom_cron_expression: '0 * * * *',
    task_prompt: 'Do something',
    ...overrides,
  };
}

/** Create a minimal TriggerUpdate payload. */
function createTriggerUpdate(overrides: Record<string, any> = {}) {
  return {
    name: 'Updated Trigger',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('triggerApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── proxyFetchTriggers ──────────────────────────────────────────

  describe('proxyFetchTriggers', () => {
    it('should call proxyFetchGet with base URL and default pagination', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggers();

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 1,
        size: 20,
      });
    });

    it('should include trigger_type when provided', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggers(TriggerType.Webhook);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 1,
        size: 20,
        trigger_type: TriggerType.Webhook,
      });
    });

    it('should include status when provided', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggers(undefined, TriggerStatus.Active);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 1,
        size: 20,
        status: TriggerStatus.Active,
      });
    });

    it('should accept custom page and size', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggers(undefined, undefined, 3, 50);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 3,
        size: 50,
      });
    });

    it('should include all optional params together', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggers(
        TriggerType.Slack,
        TriggerStatus.PendingAuth,
        2,
        10
      );

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 2,
        size: 10,
        trigger_type: TriggerType.Slack,
        status: TriggerStatus.PendingAuth,
      });
    });

    it('should re-throw on error', async () => {
      const error = new Error('Network failure');
      mockProxyFetchGet.mockRejectedValueOnce(error);

      await expect(proxyFetchTriggers()).rejects.toThrow('Network failure');
    });
  });

  // ─── proxyFetchProjectTriggers ───────────────────────────────────

  describe('proxyFetchProjectTriggers', () => {
    it('should throw when project_id is null', async () => {
      await expect(proxyFetchProjectTriggers(null)).rejects.toThrow(
        'Project ID is required to fetch project triggers.'
      );
    });

    it('should throw when project_id is empty string', async () => {
      await expect(proxyFetchProjectTriggers('')).rejects.toThrow(
        'Project ID is required to fetch project triggers.'
      );
    });

    it('should call proxyFetchGet with project_id in params', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchProjectTriggers('proj-123');

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 1,
        size: 50,
        project_id: 'proj-123',
      });
    });

    it('should include trigger_type and status when provided', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchProjectTriggers(
        'proj-456',
        TriggerType.Schedule,
        TriggerStatus.Active,
        2,
        25
      );

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/', {
        page: 2,
        size: 25,
        project_id: 'proj-456',
        trigger_type: TriggerType.Schedule,
        status: TriggerStatus.Active,
      });
    });

    it('should re-throw on error', async () => {
      const error = new Error('Server error');
      mockProxyFetchGet.mockRejectedValueOnce(error);

      await expect(proxyFetchProjectTriggers('proj-789')).rejects.toThrow(
        'Server error'
      );
    });
  });

  // ─── proxyFetchTrigger ───────────────────────────────────────────

  describe('proxyFetchTrigger', () => {
    it('should call proxyFetchGet with the trigger ID in URL', async () => {
      const mockTrigger = { id: 42, name: 'My Trigger' };
      mockProxyFetchGet.mockResolvedValueOnce(mockTrigger);

      const result = await proxyFetchTrigger(42);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/trigger/42');
      expect(result).toEqual(mockTrigger);
    });

    it('should re-throw on error', async () => {
      mockProxyFetchGet.mockRejectedValueOnce(new Error('Not found'));

      await expect(proxyFetchTrigger(999)).rejects.toThrow('Not found');
    });
  });

  // ─── proxyFetchTriggerConfig ─────────────────────────────────────

  describe('proxyFetchTriggerConfig', () => {
    it('should call proxyFetchGet with trigger type config URL', async () => {
      const mockConfig = { fields: [] };
      mockProxyFetchGet.mockResolvedValueOnce(mockConfig);

      const result = await proxyFetchTriggerConfig(TriggerType.Webhook);

      expect(mockProxyFetchGet).toHaveBeenCalledWith(
        '/api/v1/trigger/webhook/config'
      );
      expect(result).toEqual(mockConfig);
    });

    it('should re-throw on error', async () => {
      mockProxyFetchGet.mockRejectedValueOnce(new Error('Config error'));

      await expect(
        proxyFetchTriggerConfig(TriggerType.Schedule)
      ).rejects.toThrow('Config error');
    });
  });

  // ─── proxyCreateTrigger ──────────────────────────────────────────

  describe('proxyCreateTrigger', () => {
    it('should call proxyFetchPost with trigger data', async () => {
      const input = createTriggerInput();
      const created = { id: 1, ...input };
      mockProxyFetchPost.mockResolvedValueOnce(created);

      const result = await proxyCreateTrigger(input);

      expect(mockProxyFetchPost).toHaveBeenCalledWith(
        '/api/v1/trigger/',
        input
      );
      expect(result).toEqual(created);
    });

    it('should re-throw on error', async () => {
      const input = createTriggerInput();
      mockProxyFetchPost.mockRejectedValueOnce(new Error('Create failed'));

      await expect(proxyCreateTrigger(input)).rejects.toThrow('Create failed');
    });
  });

  // ─── proxyUpdateTrigger ──────────────────────────────────────────

  describe('proxyUpdateTrigger', () => {
    it('should call proxyFetchPut with trigger ID and update data', async () => {
      const update = createTriggerUpdate();
      const updated = { id: 5, ...update };
      mockProxyFetchPut.mockResolvedValueOnce(updated);

      const result = await proxyUpdateTrigger(5, update);

      expect(mockProxyFetchPut).toHaveBeenCalledWith(
        '/api/v1/trigger/5',
        update
      );
      expect(result).toEqual(updated);
    });

    it('should re-throw on error', async () => {
      mockProxyFetchPut.mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        proxyUpdateTrigger(1, createTriggerUpdate())
      ).rejects.toThrow('Update failed');
    });
  });

  // ─── proxyDeleteTrigger ──────────────────────────────────────────

  describe('proxyDeleteTrigger', () => {
    it('should call proxyFetchDelete with the trigger ID in URL', async () => {
      mockProxyFetchDelete.mockResolvedValueOnce(undefined);

      await proxyDeleteTrigger(10);

      expect(mockProxyFetchDelete).toHaveBeenCalledWith('/api/v1/trigger/10');
    });

    it('should re-throw on error', async () => {
      mockProxyFetchDelete.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(proxyDeleteTrigger(10)).rejects.toThrow('Delete failed');
    });
  });

  // ─── proxyActivateTrigger ────────────────────────────────────────

  describe('proxyActivateTrigger', () => {
    it('should call proxyFetchPost to the activate sub-route', async () => {
      const activated = { id: 3, status: 'active' };
      mockProxyFetchPost.mockResolvedValueOnce(activated);

      const result = await proxyActivateTrigger(3);

      expect(mockProxyFetchPost).toHaveBeenCalledWith(
        '/api/v1/trigger/3/activate'
      );
      expect(result).toEqual(activated);
    });

    it('should re-throw on error', async () => {
      mockProxyFetchPost.mockRejectedValueOnce(new Error('Activate failed'));

      await expect(proxyActivateTrigger(3)).rejects.toThrow('Activate failed');
    });
  });

  // ─── proxyDeactivateTrigger ──────────────────────────────────────

  describe('proxyDeactivateTrigger', () => {
    it('should call proxyFetchPost to the deactivate sub-route', async () => {
      const deactivated = { id: 3, status: 'inactive' };
      mockProxyFetchPost.mockResolvedValueOnce(deactivated);

      const result = await proxyDeactivateTrigger(3);

      expect(mockProxyFetchPost).toHaveBeenCalledWith(
        '/api/v1/trigger/3/deactivate'
      );
      expect(result).toEqual(deactivated);
    });

    it('should re-throw on error', async () => {
      mockProxyFetchPost.mockRejectedValueOnce(new Error('Deactivate failed'));

      await expect(proxyDeactivateTrigger(3)).rejects.toThrow(
        'Deactivate failed'
      );
    });
  });

  // ─── proxyFetchTriggerExecutions ─────────────────────────────────

  describe('proxyFetchTriggerExecutions', () => {
    it('should call proxyFetchGet with trigger ID executions URL and default pagination', async () => {
      const executions = { items: [] };
      mockProxyFetchGet.mockResolvedValueOnce(executions);

      const result = await proxyFetchTriggerExecutions(7);

      expect(mockProxyFetchGet).toHaveBeenCalledWith(
        '/api/v1/trigger/7/executions',
        {
          page: 1,
          size: 20,
        }
      );
      expect(result).toEqual(executions);
    });

    it('should pass custom page and size', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [] });

      await proxyFetchTriggerExecutions(7, 3, 50);

      expect(mockProxyFetchGet).toHaveBeenCalledWith(
        '/api/v1/trigger/7/executions',
        {
          page: 3,
          size: 50,
        }
      );
    });

    it('should re-throw on error', async () => {
      mockProxyFetchGet.mockRejectedValueOnce(
        new Error('Fetch executions failed')
      );

      await expect(proxyFetchTriggerExecutions(7)).rejects.toThrow(
        'Fetch executions failed'
      );
    });
  });

  // ─── proxyUpdateTriggerExecution ─────────────────────────────────

  describe('proxyUpdateTriggerExecution', () => {
    it('should call proxyFetchPut and return the result', async () => {
      const response = { id: 'exec-1', status: 'running' };
      mockProxyFetchPut.mockResolvedValueOnce(response);

      const result = await proxyUpdateTriggerExecution('exec-1', {
        status: ExecutionStatus.Running,
      });

      expect(mockProxyFetchPut).toHaveBeenCalledWith(
        '/api/v1/execution/exec-1',
        {
          status: ExecutionStatus.Running,
        }
      );
      expect(result).toEqual(response);
    });

    it('should log ExecutionSuccess when status is completed', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-ok', {
        status: ExecutionStatus.Completed,
        duration_seconds: 120,
        tokens_used: 500,
      });

      // modifyLog returns false → addLog should be called
      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-ok',
        expect.objectContaining({
          type: 'execution_success',
          message: 'Execution exec-ok completed successfully',
        })
      );
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-ok',
          type: 'execution_success',
          message: 'Execution exec-ok completed successfully',
        })
      );
    });

    it('should log ExecutionFailed when status is failed with error_message', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-fail', {
        status: ExecutionStatus.Failed,
        error_message: 'Timeout exceeded',
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-fail',
        expect.objectContaining({
          type: 'execution_failed',
          message: 'Execution exec-fail failed: Timeout exceeded',
        })
      );
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-fail',
          type: 'execution_failed',
        })
      );
    });

    it('should log ExecutionFailed without error_message suffix when absent', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-fail2', {
        status: ExecutionStatus.Failed,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-fail2',
        expect.objectContaining({
          message: 'Execution exec-fail2 failed',
        })
      );
    });

    it('should log TriggerExecuted when status is running', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-run', {
        status: ExecutionStatus.Running,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-run',
        expect.objectContaining({
          type: 'trigger_executed',
          message: 'Execution exec-run started running',
        })
      );
    });

    it('should log ExecutionCancelled when status is cancelled', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-cancel', {
        status: ExecutionStatus.Cancelled,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-cancel',
        expect.objectContaining({
          type: 'execution_cancelled',
          message: 'Execution exec-cancel was cancelled',
        })
      );
    });

    it('should use default activity type for unrecognized status values', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-unknown', {
        status: 'custom_status' as any,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-unknown',
        expect.objectContaining({
          type: 'trigger_executed',
          message: 'Execution exec-unknown status updated to custom_status',
        })
      );
    });

    it('should update existing log (modifyLog) instead of adding when modifyLog returns true', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(true);

      await proxyUpdateTriggerExecution('exec-existing', {
        status: ExecutionStatus.Completed,
      });

      expect(mockModifyLog).toHaveBeenCalled();
      expect(mockAddLog).not.toHaveBeenCalled();
    });

    it('should pass triggerInfo to the log when provided', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      const triggerInfo = {
        triggerId: 42,
        triggerName: 'Daily Cron',
        projectId: 'proj-abc',
      };

      await proxyUpdateTriggerExecution(
        'exec-info',
        {
          status: ExecutionStatus.Completed,
        },
        triggerInfo
      );

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-info',
        expect.objectContaining({
          triggerId: 42,
          triggerName: 'Daily Cron',
          projectId: 'proj-abc',
        })
      );
    });

    it('should include metadata for duration_seconds, tokens_used, and error_message', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-meta', {
        status: ExecutionStatus.Completed,
        duration_seconds: 300,
        tokens_used: 1500,
        error_message: undefined,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-meta',
        expect.objectContaining({
          metadata: {
            duration_seconds: 300,
            tokens_used: 1500,
          },
        })
      );
    });

    it('should not include tokens_used in metadata when value is 0', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-zero-tokens', {
        status: ExecutionStatus.Completed,
        tokens_used: 0,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-zero-tokens',
        expect.objectContaining({
          metadata: {},
        })
      );
    });

    it('should not include tokens_used in metadata when value is undefined', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyUpdateTriggerExecution('exec-no-tokens', {
        status: ExecutionStatus.Completed,
      });

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-no-tokens',
        expect.objectContaining({
          metadata: {},
        })
      );
    });

    it('should not log activity when status is not provided in updateData', async () => {
      mockProxyFetchPut.mockResolvedValueOnce({});

      await proxyUpdateTriggerExecution('exec-no-status', {
        duration_seconds: 100,
      });

      expect(mockModifyLog).not.toHaveBeenCalled();
      expect(mockAddLog).not.toHaveBeenCalled();
    });

    it('should re-throw on error', async () => {
      mockProxyFetchPut.mockRejectedValueOnce(
        new Error('Update execution failed')
      );

      await expect(
        proxyUpdateTriggerExecution('exec-err', {
          status: ExecutionStatus.Failed,
        })
      ).rejects.toThrow('Update execution failed');
    });
  });

  // ─── proxyRetryTriggerExecution ──────────────────────────────────

  describe('proxyRetryTriggerExecution', () => {
    it('should call proxyFetchPost to the retry sub-route', async () => {
      const retryResponse = { execution_id: 'exec-retry', status: 'pending' };
      mockProxyFetchPost.mockResolvedValueOnce(retryResponse);

      const result = await proxyRetryTriggerExecution('exec-retry');

      expect(mockProxyFetchPost).toHaveBeenCalledWith(
        '/api/v1/execution/exec-retry/retry'
      );
      expect(result).toEqual(retryResponse);
    });

    it('should log retry activity', async () => {
      mockProxyFetchPost.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      await proxyRetryTriggerExecution('exec-retry');

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-retry',
        expect.objectContaining({
          type: 'trigger_executed',
          message: 'Execution exec-retry retry initiated',
        })
      );
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-retry',
          metadata: {
            status: ExecutionStatus.Pending,
            retried: true,
          },
        })
      );
    });

    it('should pass triggerInfo to the log when provided', async () => {
      mockProxyFetchPost.mockResolvedValueOnce({});
      mockModifyLog.mockReturnValue(false);

      const triggerInfo = {
        triggerId: 10,
        triggerName: 'Hourly Sync',
        projectId: 'proj-x',
      };

      await proxyRetryTriggerExecution('exec-retry-info', triggerInfo);

      expect(mockModifyLog).toHaveBeenCalledWith(
        'exec-retry-info',
        expect.objectContaining({
          triggerId: 10,
          triggerName: 'Hourly Sync',
          projectId: 'proj-x',
        })
      );
    });

    it('should re-throw on error', async () => {
      mockProxyFetchPost.mockRejectedValueOnce(new Error('Retry failed'));

      await expect(proxyRetryTriggerExecution('exec-retry')).rejects.toThrow(
        'Retry failed'
      );
    });
  });
});
