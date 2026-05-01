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
 * SidebarStore Unit Tests
 *
 * Tests sidebar open/close/toggle state management:
 * - Initial state defaults
 * - open() action
 * - close() action
 * - toggle() action
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSidebarStore } from '../../../src/store/sidebarStore';

describe('SidebarStore', () => {
  beforeEach(() => {
    useSidebarStore.setState({ isOpen: false });
  });

  describe('Initial State', () => {
    it('should have isOpen default to false', () => {
      const { result } = renderHook(() => useSidebarStore());

      expect(result.current.isOpen).toBe(false);
    });

    it('should expose open, close, and toggle as functions', () => {
      const { result } = renderHook(() => useSidebarStore());

      expect(typeof result.current.open).toBe('function');
      expect(typeof result.current.close).toBe('function');
      expect(typeof result.current.toggle).toBe('function');
    });
  });

  describe('open', () => {
    it('should set isOpen to true', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it('should keep isOpen true when called on an already open sidebar', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);
    });
  });

  describe('close', () => {
    it('should set isOpen to false when sidebar is open', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });

      act(() => {
        result.current.close();
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('should keep isOpen false when called on an already closed sidebar', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.close();
      });

      expect(result.current.isOpen).toBe(false);
    });
  });

  describe('toggle', () => {
    it('should set isOpen to true when currently false', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isOpen).toBe(true);
    });

    it('should set isOpen to false when currently true', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isOpen).toBe(false);
    });

    it('should toggle back and forth correctly', () => {
      const { result } = renderHook(() => useSidebarStore());

      // false → true
      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);

      // true → false
      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(false);

      // false → true
      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe('Combined operations', () => {
    it('should handle open then close sequence', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.close();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it('should handle close then toggle sequence', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.close();
      });
      expect(result.current.isOpen).toBe(false);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);
    });

    it('should handle open then toggle sequence', () => {
      const { result } = renderHook(() => useSidebarStore());

      act(() => {
        result.current.open();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(false);
    });
  });
});
