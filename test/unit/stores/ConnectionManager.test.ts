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
 * ConnectionManager Tests
 *
 * Testes unitários para o módulo ConnectionManager.
 */

import { ConnectionManager } from '@/store/handlers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetchEventSource
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(),
}));

describe('ConnectionManager', () => {
  beforeEach(() => {
    // Clear all connections between tests
    ConnectionManager.closeAllConnections();
  });

  afterEach(() => {
    ConnectionManager.closeAllConnections();
  });

  describe('hasConnection', () => {
    it('should return false when no connection exists', () => {
      expect(ConnectionManager.hasConnection('task-1')).toBe(false);
    });

    it('should track connection state correctly', () => {
      const state = ConnectionManager.getConnectionState('task-1');
      expect(state).toBeUndefined();
    });
  });

  describe('getActiveConnections', () => {
    it('should return empty array when no connections', () => {
      expect(ConnectionManager.getActiveConnections()).toEqual([]);
    });
  });

  describe('closeConnection', () => {
    it('should handle closing non-existent connection gracefully', () => {
      expect(() =>
        ConnectionManager.closeConnection('non-existent')
      ).not.toThrow();
    });
  });

  describe('closeAllConnections', () => {
    it('should close all connections', () => {
      ConnectionManager.closeConnection('task-1');
      ConnectionManager.closeConnection('task-2');

      ConnectionManager.closeAllConnections();

      expect(ConnectionManager.getActiveConnections()).toEqual([]);
    });
  });

  describe('ConnectionState tracking', () => {
    it('should track connection states', () => {
      // After closing, state should be disconnected
      ConnectionManager.closeConnection('task-1');

      const state = ConnectionManager.getConnectionState('task-1');
      expect(state).toBeDefined();
      expect(state?.status).toBe('disconnected');
    });
  });

  describe('reconnect', () => {
    it('should retry with exponential backoff', async () => {
      const { fetchEventSource } =
        await import('@microsoft/fetch-event-source');

      // First call fails, second succeeds
      let callCount = 0;
      (fetchEventSource as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve();
      });

      await expect(
        ConnectionManager.reconnect(
          {
            taskId: 'task-1',
            url: 'http://localhost/test',
          },
          3,
          100
        )
      ).rejects.toThrow('Connection failed');

      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('SSEController', () => {
  it('should have closeConnection method', () => {
    expect(typeof ConnectionManager.closeConnection).toBe('function');
  });

  it('should have closeAllConnections method', () => {
    expect(typeof ConnectionManager.closeAllConnections).toBe('function');
  });

  it('should have hasConnection method', () => {
    expect(typeof ConnectionManager.hasConnection).toBe('function');
  });
});
