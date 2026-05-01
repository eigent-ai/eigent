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

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/authStore';

import { ThemeProvider } from '@/components/Layout/ThemeProvider';

describe('ThemeProvider', () => {
  let mediaQuery: {
    matches: boolean;
    media: string;
    onchange: null;
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
    addEventListener?: undefined;
    removeEventListener?: undefined;
  };
  let changeListener: (() => void) | null;

  beforeEach(() => {
    changeListener = null;

    mediaQuery = {
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn((listener: () => void) => {
        changeListener = listener;
      }),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addEventListener: undefined,
      removeEventListener: undefined,
    };

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => mediaQuery),
    });

    useAuthStore.setState({
      appearance: 'light',
      appearanceMode: 'system',
      lightColorThemeId: 'eigent',
      darkColorThemeId: 'eigent',
      customThemeCatalog: { light: {}, dark: {} },
      themeContrast: 43,
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-color-theme');
    document.documentElement.style.removeProperty('color-scheme');
    document.documentElement.style.removeProperty('--ds-theme-contrast');
  });

  it('uses addListener fallback and follows system preference changes', async () => {
    const { unmount } = render(
      <ThemeProvider>
        <div data-testid="child" />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(mediaQuery.addListener).toHaveBeenCalledTimes(1);
    expect(changeListener).toBeTruthy();

    mediaQuery.matches = false;
    act(() => {
      changeListener?.();
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    expect(useAuthStore.getState().appearance).toBe('light');

    unmount();
    expect(mediaQuery.removeListener).toHaveBeenCalledTimes(1);
  });
});
