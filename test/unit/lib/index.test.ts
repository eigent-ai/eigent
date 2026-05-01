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

import {
  capitalizeFirstLetter,
  debounce,
  generateUniqueId,
  getProxyBaseURL,
  hasStackKeys,
  uploadLog,
} from '@/lib/index';

import {
  loadProjectFromHistory,
  replayActiveTask,
  replayProject,
} from '@/lib/replay';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// generateUniqueId
// ---------------------------------------------------------------------------
describe('generateUniqueId', () => {
  it('returns string in ${timestamp}-${random} format', () => {
    const id = generateUniqueId();
    const pattern = /^\d+-\d+$/;
    expect(id).toMatch(pattern);
  });

  it('produces different IDs on successive calls', () => {
    const id1 = generateUniqueId();
    const id2 = generateUniqueId();
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------
describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays execution by wait ms', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('only last call executes (previous cancelled)', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    debounced('second');
    debounced('third');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('with immediate=true, first call executes immediately', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, true);

    debounced('now');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('now');
  });

  it('preserves this context and arguments', () => {
    const obj = {
      value: 42,
      method: vi.fn(function (this: any, arg: string) {
        return this.value + arg;
      }),
    };

    const debounced = debounce(obj.method, 50);
    debounced.call(obj, 'test');

    vi.advanceTimersByTime(50);
    expect(obj.method).toHaveBeenCalledTimes(1);
    expect(obj.method).toHaveBeenCalledWith('test');
  });
});

// ---------------------------------------------------------------------------
// capitalizeFirstLetter
// ---------------------------------------------------------------------------
describe('capitalizeFirstLetter', () => {
  it('empty string returns empty string', () => {
    expect(capitalizeFirstLetter('')).toBe('');
  });

  it('capitalizes first character of a normal string', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello');
  });

  it('does not alter already capitalized string', () => {
    expect(capitalizeFirstLetter('Hello')).toBe('Hello');
  });

  it('capitalizes single character', () => {
    expect(capitalizeFirstLetter('a')).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// hasStackKeys
// ---------------------------------------------------------------------------
describe('hasStackKeys', () => {
  it('returns truthy when all 3 env vars are set', () => {
    import.meta.env.VITE_STACK_PROJECT_ID = 'proj-1';
    import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY = 'key-1';
    import.meta.env.VITE_STACK_SECRET_SERVER_KEY = 'secret-1';
    expect(hasStackKeys()).toBeTruthy();
  });

  it('returns falsy when one env var is missing', () => {
    import.meta.env.VITE_STACK_PROJECT_ID = 'proj-1';
    import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY = 'key-1';
    delete import.meta.env.VITE_STACK_SECRET_SERVER_KEY;
    expect(hasStackKeys()).toBeFalsy();
  });

  it('returns falsy when all env vars are missing', () => {
    delete import.meta.env.VITE_STACK_PROJECT_ID;
    delete import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY;
    delete import.meta.env.VITE_STACK_SECRET_SERVER_KEY;
    expect(hasStackKeys()).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// getProxyBaseURL
// ---------------------------------------------------------------------------
describe('getProxyBaseURL', () => {
  it('returns proxy URL in dev mode', () => {
    import.meta.env.DEV = true as any;
    import.meta.env.VITE_PROXY_URL = 'http://localhost:9999';
    expect(getProxyBaseURL()).toBe('http://localhost:9999');
  });

  it('returns default localhost when VITE_PROXY_URL is empty in dev', () => {
    import.meta.env.DEV = true as any;
    import.meta.env.VITE_PROXY_URL = '';
    expect(getProxyBaseURL()).toBe('http://localhost:3001');
  });

  it('returns base URL in production mode', () => {
    import.meta.env.DEV = false as any;
    import.meta.env.VITE_BASE_URL = 'https://api.example.com';
    expect(getProxyBaseURL()).toBe('https://api.example.com');
  });

  it('throws when VITE_BASE_URL is empty in production', () => {
    import.meta.env.DEV = false as any;
    import.meta.env.VITE_BASE_URL = '';
    expect(() => getProxyBaseURL()).toThrow('VITE_BASE_URL is not configured');
  });
});

// ---------------------------------------------------------------------------
// Re-exports & uploadLog
// ---------------------------------------------------------------------------
describe('re-exports and uploadLog', () => {
  it('uploadLog is a function', () => {
    expect(typeof uploadLog).toBe('function');
  });

  it('loadProjectFromHistory is a function', () => {
    expect(typeof loadProjectFromHistory).toBe('function');
  });

  it('replayActiveTask is a function', () => {
    expect(typeof replayActiveTask).toBe('function');
  });

  it('replayProject is a function', () => {
    expect(typeof replayProject).toBe('function');
  });
});
