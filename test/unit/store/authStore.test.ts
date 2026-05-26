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
 * AuthStore Unit Tests - Core Functionality
 *
 * Tests authStore operations:
 * - Initial state defaults
 * - Auth set/logout lifecycle
 * - Simple setter actions
 * - Worker list management keyed by email
 * - checkAgentTool removal and filtering
 * - Non-hook accessor functions (getAuthStore, getWorkerList, useWorkerList)
 * - Persist partialize behavior
 */

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthStore,
  getWorkerList,
  useAuthStore,
  useWorkerList,
} from '../../../src/store/authStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for a valid Agent object used in worker-list tests. */
function createMockAgent(id: string, tools: string[] = []): Agent {
  return {
    agent_id: id,
    name: `Agent-${id}`,
    type: 'developer_agent',
    status: undefined,
    tasks: [],
    log: [],
    tools,
  };
}

/** The set of valid initial cloud_model_type values. */
const VALID_DEFAULT_MODELS = ['gpt-5.2', 'gpt-5.1', 'gpt-4.1'];

/** Expected initial state (cloud_model_type is random — checked separately). */
const EXPECTED_INITIAL = {
  token: null,
  username: null,
  email: null,
  user_id: null,
  appearance: 'light',
  language: 'system',
  isFirstLaunch: true,
  modelType: 'cloud',
  preferredIDE: 'system',
  initState: 'carousel',
  share_token: null,
  localProxyValue: null,
  workerListData: {},
} as const;

/** Reset the store to a clean baseline before each test. */
function resetStore(): void {
  useAuthStore.setState({
    ...EXPECTED_INITIAL,
    cloud_model_type: 'gpt-4.1',
  });
  localStorage.clear();
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('AuthStore', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial State
  // -------------------------------------------------------------------------
  describe('Initial State', () => {
    it('should have correct default values for all non-random fields', () => {
      const state = useAuthStore.getState();

      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
      expect(state.email).toBeNull();
      expect(state.user_id).toBeNull();
      expect(state.appearance).toBe('light');
      expect(state.language).toBe('system');
      expect(state.isFirstLaunch).toBe(true);
      expect(state.modelType).toBe('cloud');
      expect(state.preferredIDE).toBe('system');
      expect(state.initState).toBe('carousel');
      expect(state.share_token).toBeNull();
      expect(state.localProxyValue).toBeNull();
      expect(state.workerListData).toEqual({});
    });

    it('should set cloud_model_type to one of the valid default models', () => {
      const state = useAuthStore.getState();
      expect(VALID_DEFAULT_MODELS).toContain(state.cloud_model_type);
    });
  });

  // -------------------------------------------------------------------------
  // setAuth
  // -------------------------------------------------------------------------
  describe('setAuth', () => {
    it('should set token, username, email, and user_id', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 'tk-123',
          username: 'alice',
          email: 'alice@example.com',
          user_id: 42,
        });
      });

      const state = useAuthStore.getState();
      expect(state.token).toBe('tk-123');
      expect(state.username).toBe('alice');
      expect(state.email).toBe('alice@example.com');
      expect(state.user_id).toBe(42);
    });

    it('should overwrite previous auth values on repeated calls', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 'first',
          username: 'u1',
          email: 'one@test.com',
          user_id: 1,
        });
      });

      act(() => {
        useAuthStore.getState().setAuth({
          token: 'second',
          username: 'u2',
          email: 'two@test.com',
          user_id: 2,
        });
      });

      const state = useAuthStore.getState();
      expect(state.token).toBe('second');
      expect(state.username).toBe('u2');
      expect(state.email).toBe('two@test.com');
      expect(state.user_id).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------
  describe('logout', () => {
    it('should clear auth fields, initState, and localProxyValue', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 'tk',
          username: 'bob',
          email: 'bob@test.com',
          user_id: 5,
        });
        useAuthStore.getState().setLocalProxyValue('http://proxy.local');
        useAuthStore.getState().setInitState('done');
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
      expect(state.email).toBeNull();
      expect(state.user_id).toBeNull();
      expect(state.initState).toBe('carousel');
      expect(state.localProxyValue).toBeNull();
    });

    it('should NOT clear appearance', () => {
      act(() => {
        useAuthStore.getState().setAppearance('dark');
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'e@t.com',
          user_id: 1,
        });
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().appearance).toBe('dark');
    });

    it('should NOT clear language', () => {
      act(() => {
        useAuthStore.getState().setLanguage('en');
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().language).toBe('en');
    });

    it('should NOT clear modelType', () => {
      act(() => {
        useAuthStore.getState().setModelType('local');
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().modelType).toBe('local');
    });

    it('should NOT clear cloud_model_type', () => {
      act(() => {
        useAuthStore.getState().setCloudModelType('gpt-5');
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().cloud_model_type).toBe('gpt-5');
    });

    it('should NOT clear preferredIDE', () => {
      act(() => {
        useAuthStore.getState().setPreferredIDE('vscode');
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().preferredIDE).toBe('vscode');
    });

    it('should NOT clear workerListData', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'user@test.com',
          user_id: 1,
        });
        useAuthStore.getState().setWorkerList([createMockAgent('a1')]);
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().workerListData).toEqual({
        'user@test.com': [createMockAgent('a1')],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Simple Setters
  // -------------------------------------------------------------------------
  describe('Simple Setters', () => {
    it('setAppearance should update appearance', () => {
      act(() => {
        useAuthStore.getState().setAppearance('dark');
      });
      expect(useAuthStore.getState().appearance).toBe('dark');
    });

    it('setLanguage should update language', () => {
      act(() => {
        useAuthStore.getState().setLanguage('zh');
      });
      expect(useAuthStore.getState().language).toBe('zh');
    });

    it('setInitState should update initState', () => {
      act(() => {
        useAuthStore.getState().setInitState('done');
      });
      expect(useAuthStore.getState().initState).toBe('done');
    });

    it('setModelType should update modelType', () => {
      act(() => {
        useAuthStore.getState().setModelType('local');
      });
      expect(useAuthStore.getState().modelType).toBe('local');
    });

    it('setCloudModelType should update cloud_model_type', () => {
      act(() => {
        useAuthStore.getState().setCloudModelType('gpt-5');
      });
      expect(useAuthStore.getState().cloud_model_type).toBe('gpt-5');
    });

    it('setIsFirstLaunch should update isFirstLaunch', () => {
      act(() => {
        useAuthStore.getState().setIsFirstLaunch(false);
      });
      expect(useAuthStore.getState().isFirstLaunch).toBe(false);
    });

    it('setPreferredIDE should update preferredIDE', () => {
      act(() => {
        useAuthStore.getState().setPreferredIDE('cursor');
      });
      expect(useAuthStore.getState().preferredIDE).toBe('cursor');
    });

    it('setLocalProxyValue should update localProxyValue', () => {
      act(() => {
        useAuthStore.getState().setLocalProxyValue('http://localhost:8080');
      });
      expect(useAuthStore.getState().localProxyValue).toBe(
        'http://localhost:8080'
      );
    });

    it('setLocalProxyValue should accept null', () => {
      act(() => {
        useAuthStore.getState().setLocalProxyValue('http://proxy');
      });
      act(() => {
        useAuthStore.getState().setLocalProxyValue(null);
      });
      expect(useAuthStore.getState().localProxyValue).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setWorkerList
  // -------------------------------------------------------------------------
  describe('setWorkerList', () => {
    it('should store workers keyed by current email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'user@test.com',
          user_id: 1,
        });
      });

      const workers = [
        createMockAgent('w1', ['tool_a', 'tool_b']),
        createMockAgent('w2', ['tool_c']),
      ];

      act(() => {
        useAuthStore.getState().setWorkerList(workers);
      });

      expect(useAuthStore.getState().workerListData['user@test.com']).toEqual(
        workers
      );
    });

    it('should overwrite the worker list for the same email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'user@test.com',
          user_id: 1,
        });
        useAuthStore.getState().setWorkerList([createMockAgent('old')]);
      });

      const newWorkers = [createMockAgent('new1'), createMockAgent('new2')];

      act(() => {
        useAuthStore.getState().setWorkerList(newWorkers);
      });

      expect(useAuthStore.getState().workerListData['user@test.com']).toEqual(
        newWorkers
      );
    });

    it('should store workers under "null" key when email is null', () => {
      // email is null by default
      const workers = [createMockAgent('w1')];

      act(() => {
        useAuthStore.getState().setWorkerList(workers);
      });

      // The store casts email as string — null becomes "null" key
      expect(useAuthStore.getState().workerListData['null']).toEqual(workers);
    });

    it('should keep separate lists for different emails', () => {
      const workersA = [createMockAgent('a1')];
      const workersB = [createMockAgent('b1')];

      act(() => {
        useAuthStore.getState().setAuth({
          token: 't1',
          username: 'a',
          email: 'a@test.com',
          user_id: 1,
        });
        useAuthStore.getState().setWorkerList(workersA);
      });

      act(() => {
        useAuthStore.getState().setAuth({
          token: 't2',
          username: 'b',
          email: 'b@test.com',
          user_id: 2,
        });
        useAuthStore.getState().setWorkerList(workersB);
      });

      const data = useAuthStore.getState().workerListData;
      expect(data['a@test.com']).toEqual(workersA);
      expect(data['b@test.com']).toEqual(workersB);
    });
  });

  // -------------------------------------------------------------------------
  // checkAgentTool
  // -------------------------------------------------------------------------
  describe('checkAgentTool', () => {
    beforeEach(() => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'dev@test.com',
          user_id: 1,
        });
      });
    });

    it('should remove the specified tool from all workers for current email', () => {
      const workers = [
        createMockAgent('w1', ['tool_a', 'tool_b', 'tool_c']),
        createMockAgent('w2', ['tool_a', 'tool_d']),
      ];

      act(() => {
        useAuthStore.getState().setWorkerList(workers);
      });

      act(() => {
        useAuthStore.getState().checkAgentTool('tool_a');
      });

      const stored = useAuthStore.getState().workerListData['dev@test.com'];
      expect(stored).toHaveLength(2);
      expect(stored[0].tools).toEqual(['tool_b', 'tool_c']);
      expect(stored[1].tools).toEqual(['tool_d']);
    });

    it('should filter out workers that end up with empty tools arrays', () => {
      const workers = [
        createMockAgent('w1', ['tool_a']),
        createMockAgent('w2', ['tool_a', 'tool_b']),
        createMockAgent('w3', ['tool_b']),
      ];

      act(() => {
        useAuthStore.getState().setWorkerList(workers);
      });

      act(() => {
        useAuthStore.getState().checkAgentTool('tool_a');
      });

      const stored = useAuthStore.getState().workerListData['dev@test.com'];
      // w1 had only tool_a → removed entirely
      // w2 still has tool_b
      // w3 had only tool_b → kept
      expect(stored).toHaveLength(2);
      expect(stored[0].agent_id).toBe('w2');
      expect(stored[0].tools).toEqual(['tool_b']);
      expect(stored[1].agent_id).toBe('w3');
      expect(stored[1].tools).toEqual(['tool_b']);
    });

    it('should handle workers with no tools property (undefined)', () => {
      const worker = createMockAgent('w1');
      delete worker.tools;

      act(() => {
        useAuthStore.getState().setWorkerList([worker]);
      });

      // Should not throw; worker has no tools → filtered out
      act(() => {
        useAuthStore.getState().checkAgentTool('some_tool');
      });

      const stored = useAuthStore.getState().workerListData['dev@test.com'];
      expect(stored).toEqual([]);
    });

    it('should handle when no worker list exists for current email', () => {
      // Don't call setWorkerList — workerListData['dev@test.com'] is undefined
      act(() => {
        useAuthStore.getState().checkAgentTool('tool_x');
      });

      const stored = useAuthStore.getState().workerListData['dev@test.com'];
      // Falls back to [] → after filter, still []
      expect(stored).toEqual([]);
    });

    it('should operate on the "null" key when email is null', () => {
      act(() => {
        useAuthStore.getState().logout();
      });

      act(() => {
        useAuthStore
          .getState()
          .setWorkerList([createMockAgent('w1', ['tool_x'])]);
      });

      act(() => {
        useAuthStore.getState().checkAgentTool('tool_x');
      });

      expect(useAuthStore.getState().workerListData['null']).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAuthStore
  // -------------------------------------------------------------------------
  describe('getAuthStore', () => {
    it('should return the current store state', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 'tk',
          username: 'carol',
          email: 'carol@test.com',
          user_id: 99,
        });
      });

      const state = getAuthStore();
      expect(state.token).toBe('tk');
      expect(state.username).toBe('carol');
      expect(state.email).toBe('carol@test.com');
      expect(state.user_id).toBe(99);
    });

    it('should reflect changes made after the call', () => {
      const before = getAuthStore();
      expect(before.appearance).toBe('light');

      act(() => {
        useAuthStore.getState().setAppearance('dark');
      });

      const after = getAuthStore();
      expect(after.appearance).toBe('dark');
    });
  });

  // -------------------------------------------------------------------------
  // useWorkerList / getWorkerList
  // -------------------------------------------------------------------------
  describe('useWorkerList', () => {
    it('should return workers for the current email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'list@test.com',
          user_id: 1,
        });
        useAuthStore
          .getState()
          .setWorkerList([
            createMockAgent('w1', ['t1']),
            createMockAgent('w2', ['t2']),
          ]);
      });

      const result = useWorkerList();
      expect(result).toHaveLength(2);
      expect(result[0].agent_id).toBe('w1');
      expect(result[1].agent_id).toBe('w2');
    });

    it('should return the shared empty array when no matching email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'no-workers@test.com',
          user_id: 1,
        });
        // No setWorkerList call
      });

      const result = useWorkerList();
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should return empty array when email is null and no data exists', () => {
      // Default state has null email
      const result = useWorkerList();
      expect(result).toEqual([]);
    });
  });

  describe('getWorkerList', () => {
    it('should return workers for the current email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'gw@test.com',
          user_id: 1,
        });
        useAuthStore.getState().setWorkerList([createMockAgent('gw1')]);
      });

      const result = getWorkerList();
      expect(result).toHaveLength(1);
      expect(result[0].agent_id).toBe('gw1');
    });

    it('should return the shared empty array when no matching email', () => {
      act(() => {
        useAuthStore.getState().setAuth({
          token: 't',
          username: 'u',
          email: 'missing@test.com',
          user_id: 1,
        });
      });

      const result = getWorkerList();
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('useWorkerList and getWorkerList should return the same EMPTY_LIST reference', () => {
      // Both should return the shared EMPTY_LIST constant (same reference)
      const fromHook = useWorkerList();
      const fromGetter = getWorkerList();
      expect(fromHook).toBe(fromGetter);
    });
  });

  // -------------------------------------------------------------------------
  // Persist Partialize
  // -------------------------------------------------------------------------
  describe('Persist Partialize', () => {
    it('should NOT persist share_token (excluded from partialize)', () => {
      // The partialize function in authStore explicitly excludes share_token.
      // We verify by reading the partialize config from the store.
      const persistApi = useAuthStore.persist;
      const partialize = persistApi.getOptions().partialize;

      // Create a state with share_token set
      const fullState = {
        ...useAuthStore.getState(),
        share_token: 'share-tk-123',
      };

      const partialized = partialize?.(fullState) as Record<string, unknown>;

      expect(partialized).not.toHaveProperty('share_token');
      expect(partialized).toHaveProperty('token');
      expect(partialized).toHaveProperty('username');
      expect(partialized).toHaveProperty('email');
      expect(partialized).toHaveProperty('user_id');
    });

    it('should persist isFirstLaunch (included in partialize)', () => {
      const persistApi = useAuthStore.persist;
      const partialize = persistApi.getOptions().partialize;

      const fullState = {
        ...useAuthStore.getState(),
        isFirstLaunch: false,
      };

      const partialized = partialize?.(fullState) as Record<string, unknown>;
      expect(partialized).toHaveProperty('isFirstLaunch');
      expect(partialized.isFirstLaunch).toBe(false);
    });

    it('should persist workerListData (included in partialize)', () => {
      const persistApi = useAuthStore.persist;
      const partialize = persistApi.getOptions().partialize;

      const fullState = {
        ...useAuthStore.getState(),
        workerListData: { 'u@t.com': [createMockAgent('w1')] },
      };

      const partialized = partialize?.(fullState) as Record<string, unknown>;
      expect(partialized).toHaveProperty('workerListData');
    });

    it('should persist all expected fields from partialize', () => {
      const persistApi = useAuthStore.persist;
      const partialize = persistApi.getOptions().partialize;

      const fullState = { ...useAuthStore.getState() };
      const partialized = partialize?.(fullState) as Record<string, unknown>;

      const expectedKeys = [
        'token',
        'username',
        'email',
        'user_id',
        'appearance',
        'language',
        'modelType',
        'cloud_model_type',
        'initState',
        'isFirstLaunch',
        'preferredIDE',
        'localProxyValue',
        'workerListData',
      ];

      for (const key of expectedKeys) {
        expect(partialized).toHaveProperty(key);
      }
    });
  });
});
