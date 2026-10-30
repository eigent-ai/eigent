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
 * WorkflowViewportStore Unit Tests
 *
 * Tests viewport navigation function management:
 * - Initial state defaults
 * - setMoveLeft/setMoveRight with function and null
 * - Stored functions are callable
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowViewportStore } from '../../../src/store/workflowViewportStore';

describe('WorkflowViewportStore', () => {
  beforeEach(() => {
    useWorkflowViewportStore.setState({
      moveLeft: null,
      moveRight: null,
    });
  });

  describe('Initial State', () => {
    it('should have moveLeft set to null', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());

      expect(result.current.moveLeft).toBeNull();
    });

    it('should have moveRight set to null', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());

      expect(result.current.moveRight).toBeNull();
    });

    it('should expose setMoveLeft and setMoveRight as functions', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());

      expect(typeof result.current.setMoveLeft).toBe('function');
      expect(typeof result.current.setMoveRight).toBe('function');
    });
  });

  describe('setMoveLeft', () => {
    it('should store a function', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveLeft(fn);
      });

      expect(result.current.moveLeft).toBe(fn);
    });

    it('should set moveLeft to null', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveLeft(fn);
      });

      act(() => {
        result.current.setMoveLeft(null);
      });

      expect(result.current.moveLeft).toBeNull();
    });

    it('should store a callable function that executes correctly', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveLeft(fn);
      });

      // Call the stored function
      act(() => {
        result.current.moveLeft!();
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should replace a previously stored function', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      act(() => {
        result.current.setMoveLeft(fn1);
      });

      act(() => {
        result.current.setMoveLeft(fn2);
      });

      expect(result.current.moveLeft).toBe(fn2);
      expect(result.current.moveLeft).not.toBe(fn1);
    });
  });

  describe('setMoveRight', () => {
    it('should store a function', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveRight(fn);
      });

      expect(result.current.moveRight).toBe(fn);
    });

    it('should set moveRight to null', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveRight(fn);
      });

      act(() => {
        result.current.setMoveRight(null);
      });

      expect(result.current.moveRight).toBeNull();
    });

    it('should store a callable function that executes correctly', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn = vi.fn();

      act(() => {
        result.current.setMoveRight(fn);
      });

      act(() => {
        result.current.moveRight!();
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should replace a previously stored function', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      act(() => {
        result.current.setMoveRight(fn1);
      });

      act(() => {
        result.current.setMoveRight(fn2);
      });

      expect(result.current.moveRight).toBe(fn2);
    });
  });

  describe('Independence', () => {
    it('should not affect moveRight when setting moveLeft', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const leftFn = vi.fn();
      const rightFn = vi.fn();

      act(() => {
        result.current.setMoveRight(rightFn);
        result.current.setMoveLeft(leftFn);
      });

      expect(result.current.moveLeft).toBe(leftFn);
      expect(result.current.moveRight).toBe(rightFn);
    });

    it('should not affect moveLeft when setting moveRight', () => {
      const { result } = renderHook(() => useWorkflowViewportStore());
      const leftFn = vi.fn();

      act(() => {
        result.current.setMoveLeft(leftFn);
        result.current.setMoveRight(vi.fn());
      });

      expect(result.current.moveLeft).toBe(leftFn);
    });
  });
});
