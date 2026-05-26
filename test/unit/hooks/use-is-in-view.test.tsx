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

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock motion/react before importing the hook
const mockUseInView = vi.fn<(ref: any, options?: any) => boolean>(() => true);
vi.mock('motion/react', () => ({
  useInView: (ref: any, options?: any) => mockUseInView(ref, options),
}));

import { useIsInView } from '../../../src/hooks/use-is-in-view';

describe('useIsInView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInView.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return isInView true when useInView returns true and no options', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref));

    // No inView option → !undefined = true → short-circuits to true
    expect(result.current.isInView).toBe(true);
  });

  it('should return isInView true when useInView returns false and no options', () => {
    mockUseInView.mockReturnValue(false);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref));

    // No inView option → !undefined = true → short-circuits to true
    // regardless of useInView returning false
    expect(result.current.isInView).toBe(true);
  });

  it('should return isInView true when inView is true and useInView returns true', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref, { inView: true }));

    expect(result.current.isInView).toBe(true);
  });

  it('should return isInView false when inView is true and useInView returns false', () => {
    mockUseInView.mockReturnValue(false);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref, { inView: true }));

    // inView: true → !true = false → returns inViewResult (false)
    expect(result.current.isInView).toBe(false);
  });

  it('should return isInView true when inView is false (code: !false || result)', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref, { inView: false }));

    // inView: false → !false = true → short-circuits to true
    expect(result.current.isInView).toBe(true);
  });

  it('should return isInView true when inView is false even if useInView returns false', () => {
    mockUseInView.mockReturnValue(false);
    const ref = { current: null };
    const { result } = renderHook(() => useIsInView(ref, { inView: false }));

    // inView: false → !false = true → short-circuits to true
    expect(result.current.isInView).toBe(true);
  });

  it('should pass inViewOnce as once option to useInView', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    renderHook(() => useIsInView(ref, { inViewOnce: true }));

    expect(mockUseInView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ once: true })
    );
  });

  it('should pass inViewMargin as margin option to useInView', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    renderHook(() => useIsInView(ref, { inViewMargin: '100px' }));

    expect(mockUseInView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ margin: '100px' })
    );
  });

  it('should use default options once=false and margin="0px" when not specified', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    renderHook(() => useIsInView(ref));

    expect(mockUseInView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ once: false, margin: '0px' })
    );
  });

  it('should return a ref object', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    const { result } = renderHook(() => useIsInView(ref));

    expect(result.current.ref).toBeDefined();
    expect(result.current.ref).toHaveProperty('current');
  });

  it('should call useInView with the local ref', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    renderHook(() => useIsInView(ref));

    // useInView should be called with a ref object
    const callArgs = mockUseInView.mock.calls as Array<Array<any>>;
    const calledWithRef = callArgs[0][0];
    expect(calledWithRef).toBeDefined();
    expect(calledWithRef).toHaveProperty('current');
  });

  it('should forward all options together to useInView', () => {
    mockUseInView.mockReturnValue(true);
    const ref = { current: null };

    renderHook(() =>
      useIsInView(ref, {
        inView: true,
        inViewOnce: true,
        inViewMargin: '50px 0px',
      })
    );

    expect(mockUseInView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        once: true,
        margin: '50px 0px',
      })
    );
  });
});
