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
 * GlobalStore Unit Tests
 *
 * Tests history type management with persist middleware:
 * - Initial state defaults
 * - Direct history type setting
 * - Toggle cycling (grid → list → table → grid)
 * - Non-hook accessor (getGlobalStore)
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getGlobalStore, useGlobalStore } from '../../../src/store/globalStore';

describe('GlobalStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useGlobalStore.setState({
      history_type: 'list',
    });
  });

  describe('Initial State', () => {
    it('should have history_type default to "list"', () => {
      const { result } = renderHook(() => useGlobalStore());

      expect(result.current.history_type).toBe('list');
    });

    it('should expose setHistoryType as a function', () => {
      const { result } = renderHook(() => useGlobalStore());

      expect(typeof result.current.setHistoryType).toBe('function');
    });

    it('should expose toggleHistoryType as a function', () => {
      const { result } = renderHook(() => useGlobalStore());

      expect(typeof result.current.toggleHistoryType).toBe('function');
    });
  });

  describe('setHistoryType', () => {
    it('should set history_type to "grid"', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('grid');
      });

      expect(result.current.history_type).toBe('grid');
    });

    it('should set history_type to "list"', () => {
      const { result } = renderHook(() => useGlobalStore());

      // Change away first
      act(() => {
        result.current.setHistoryType('grid');
      });

      // Set back to list
      act(() => {
        result.current.setHistoryType('list');
      });

      expect(result.current.history_type).toBe('list');
    });

    it('should set history_type to "table"', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('table');
      });

      expect(result.current.history_type).toBe('table');
    });

    it('should replace the current value when called multiple times', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('grid');
      });
      act(() => {
        result.current.setHistoryType('table');
      });

      expect(result.current.history_type).toBe('table');
    });
  });

  describe('toggleHistoryType', () => {
    it('should cycle from list to table', () => {
      const { result } = renderHook(() => useGlobalStore());

      // Initial state is 'list'
      act(() => {
        result.current.toggleHistoryType();
      });

      expect(result.current.history_type).toBe('table');
    });

    it('should cycle from table to grid', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('table');
      });

      act(() => {
        result.current.toggleHistoryType();
      });

      expect(result.current.history_type).toBe('grid');
    });

    it('should cycle from grid to list', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('grid');
      });

      act(() => {
        result.current.toggleHistoryType();
      });

      expect(result.current.history_type).toBe('list');
    });

    it('should complete a full cycle: list → table → grid → list', () => {
      const { result } = renderHook(() => useGlobalStore());

      // list → table
      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('table');

      // table → grid
      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('grid');

      // grid → list
      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('list');
    });

    it('should cycle correctly regardless of starting state', () => {
      const { result } = renderHook(() => useGlobalStore());

      act(() => {
        result.current.setHistoryType('grid');
      });

      // grid → list → table → grid
      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('list');

      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('table');

      act(() => {
        result.current.toggleHistoryType();
      });
      expect(result.current.history_type).toBe('grid');
    });
  });

  describe('getGlobalStore', () => {
    it('should return the current store state', () => {
      const state = getGlobalStore();

      expect(state.history_type).toBe('list');
    });

    it('should reflect changes made via useGlobalStore', () => {
      act(() => {
        useGlobalStore.getState().setHistoryType('grid');
      });

      const state = getGlobalStore();

      expect(state.history_type).toBe('grid');
    });

    it('should allow reading state without a React hook', () => {
      act(() => {
        useGlobalStore.getState().setHistoryType('table');
      });

      expect(getGlobalStore().history_type).toBe('table');
    });
  });
});
