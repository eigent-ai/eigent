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

// Global test setup file
import enUs from '@/i18n/locales/en-us/index';
import '@testing-library/jest-dom';
import i18next from 'i18next';
import { vi } from 'vitest';

void i18next.init({
  resources: { 'en-US': { translation: enUs } },
  fallbackLng: 'en-US',
  lng: 'en-US',
  initImmediate: false,
  interpolation: { escapeValue: false },
});

// Mock react-i18next against the shipped en-US bundle so assertions read the
// real product copy instead of a table that drifts from it.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createElement } = await import('react');
  const enUs = (await import('@/i18n/locales/en-us/index')).default;

  const resolve = (key: string): string | undefined => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (current, segment) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[segment]
            : undefined,
        enUs as unknown
      );
    return typeof value === 'string' ? value : undefined;
  };

  return {
    Trans: (props: Parameters<typeof actual.Trans>[0]) =>
      createElement(actual.Trans, { ...props, i18n: i18next }),
    useTranslation: () => ({
      t: (key: string, options: Record<string, unknown> = {}) => {
        const count = options.count;
        const pluralKey =
          typeof count === 'number'
            ? `${key}_${count === 1 ? 'one' : 'other'}`
            : key;
        return (
          resolve(pluralKey) ??
          resolve(key) ??
          String(options.defaultValue ?? key)
        ).replace(/{{(\w+)}}/g, (_match, name: string) =>
          String(options[name] ?? '')
        );
      },
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
    initReactI18next: {
      type: '3rdParty',
      init: vi.fn(),
    },
  };
});

// Mock Electron APIs if needed
global.electronAPI = {
  // Add mock implementations for electron preload APIs
};

// Mock ipcRenderer
global.ipcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Mock environment variables
process.env.NODE_ENV = 'test';

// Node can expose a partial localStorage object when no backing file is
// configured. Replace it with a deterministic in-memory implementation so
// persisted Zustand stores behave consistently in unit tests.
const localStorageValues = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: vi.fn(() => localStorageValues.clear()),
  getItem: vi.fn((key: string) => localStorageValues.get(key) ?? null),
  key: vi.fn((index: number) => [...localStorageValues.keys()][index] ?? null),
  removeItem: vi.fn((key: string) => {
    localStorageValues.delete(key);
  }),
  setItem: vi.fn((key: string, value: string) => {
    localStorageValues.set(key, String(value));
  }),
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

// Global test utilities
global.waitFor = async (callback: () => boolean, timeout = 5000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await callback()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
};

// Add type declarations for globals
declare global {
  var electronAPI: any;
  var ipcRenderer: any;
  var waitFor: (callback: () => boolean, timeout?: number) => Promise<void>;
}

// Setup DOM environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
