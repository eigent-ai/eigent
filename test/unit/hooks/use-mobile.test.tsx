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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from '../../../src/hooks/use-mobile';

describe('useIsMobile', () => {
  let changeHandler: (() => void) | null = null;
  let removeEventListenerSpy: ReturnType<typeof vi.fn>;

  function setInnerWidth(value: number) {
    Object.defineProperty(window, 'innerWidth', {
      value,
      writable: true,
      configurable: true,
    });
  }

  function createMockMql() {
    changeHandler = null;
    removeEventListenerSpy = vi.fn();

    const mockMql = {
      matches: false,
      media: '(max-width: 767px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        changeHandler = handler;
      }),
      removeEventListener: removeEventListenerSpy,
      dispatchEvent: vi.fn(),
    };

    return mockMql;
  }

  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(createMockMql() as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false for desktop width (>=768)', () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should return false at exactly the breakpoint width (768)', () => {
    setInnerWidth(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should return true for mobile width (<768)', () => {
    setInnerWidth(375);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should return true at one pixel below breakpoint (767)', () => {
    setInnerWidth(767);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should update when resizing from desktop to mobile', () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    setInnerWidth(375);
    act(() => {
      changeHandler?.();
    });

    expect(result.current).toBe(true);
  });

  it('should update when resizing from mobile to desktop', () => {
    setInnerWidth(375);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    setInnerWidth(1024);
    act(() => {
      changeHandler?.();
    });

    expect(result.current).toBe(false);
  });

  it('should register a change event listener on matchMedia', () => {
    setInnerWidth(1024);
    renderHook(() => useIsMobile());

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
    expect(changeHandler).not.toBeNull();
  });

  it('should remove event listener on unmount', () => {
    setInnerWidth(1024);
    const { unmount } = renderHook(() => useIsMobile());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('should handle multiple resize events', () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Desktop → mobile
    setInnerWidth(320);
    act(() => {
      changeHandler?.();
    });
    expect(result.current).toBe(true);

    // Mobile → desktop
    setInnerWidth(1440);
    act(() => {
      changeHandler?.();
    });
    expect(result.current).toBe(false);

    // Desktop → mobile again
    setInnerWidth(500);
    act(() => {
      changeHandler?.();
    });
    expect(result.current).toBe(true);
  });
});
