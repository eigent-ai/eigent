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
  changedAuthEnvironmentParts,
  getAuthEnvironmentKey,
} from '@/lib/authEnvironment';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORED_KEY =
  'mode:production|local:|base:https://old.example.com|proxy:https://old.example.com|brain:|stack:project-a';
const CURRENT_KEY =
  'mode:production|local:|base:https://new.example.com|proxy:https://new.example.com|brain:|stack:project-a';

describe('changedAuthEnvironmentParts', () => {
  it('names only the parts that differ', () => {
    expect(changedAuthEnvironmentParts(STORED_KEY, CURRENT_KEY)).toEqual([
      'base',
      'proxy',
    ]);
  });

  it('reports nothing for the same environment', () => {
    expect(changedAuthEnvironmentParts(CURRENT_KEY, CURRENT_KEY)).toEqual([]);
  });

  it('reports a stored sign-in that never recorded its environment', () => {
    expect(changedAuthEnvironmentParts(null, CURRENT_KEY)).toEqual([
      'unrecorded',
    ]);
  });
});

// Load the store after the HTTP layer, the order the app itself uses.
const loadAuthStore = async () => {
  await import('@/api/http');
  return (await import('@/store/authStore')).useAuthStore;
};

describe('auth cleared for another build environment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs which parts changed, without values, when an update clears sign-in', async () => {
    const useAuthStore = await loadAuthStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const migrate = useAuthStore.persist.getOptions().migrate!;

    const migrated = migrate(
      {
        token: 'secret-token',
        email: 'user@example.com',
        user_id: 7,
        authEnvironmentKey: STORED_KEY,
      },
      11
    ) as { token: unknown; authEnvironmentKey: unknown };

    expect(migrated.token).toBeNull();
    expect(migrated.authEnvironmentKey).toBe(getAuthEnvironmentKey());
    const messages = warn.mock.calls.map((call) => String(call[0]));
    const line = messages.find((message) =>
      message.startsWith('[authStore] Cleared sign-in')
    );
    expect(line).toBeDefined();
    expect(line).toMatch(/: .*\bbase\b/);
    expect(line).not.toContain('old.example.com');
    expect(line).not.toContain('secret-token');
  });

  it('stays quiet when the environment is unchanged', async () => {
    const useAuthStore = await loadAuthStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const migrate = useAuthStore.persist.getOptions().migrate!;

    const migrated = migrate(
      {
        token: 'secret-token',
        user_id: 7,
        authEnvironmentKey: getAuthEnvironmentKey(),
      },
      11
    ) as { token: unknown };

    expect(migrated.token).toBe('secret-token');
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).startsWith('[authStore] Cleared sign-in')
      )
    ).toBe(false);
  });
});
