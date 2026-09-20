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
  proxyCreateSpace,
  proxyUpdateSpace,
  toLocalSpace,
  UnsupportedSpaceCategoryPreferenceError,
  type ServerSpace,
} from '@/service/spaceApi';
import { afterEach, describe, expect, it, vi } from 'vitest';

const serverSpace = (categoryKey?: string | null): ServerSpace => ({
  id: 'space-1',
  user_id: 'user-1',
  name: 'Planning',
  source_type: 'blank',
  status: 'active',
  category_key: categoryKey,
  schema_version: 1,
});

describe('Space category desktop mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('preserves an opaque content-defined category key', () => {
    expect(toLocalSpace(serverSpace('revenue-operations')).categoryKey).toBe(
      'revenue-operations'
    );
  });

  it('treats a category omitted by an older server as unset', () => {
    expect(toLocalSpace(serverSpace()).categoryKey).toBeNull();
  });

  it('rejects a category update ignored by an older server', async () => {
    const { category_key: _categoryKey, ...olderServerResponse } =
      serverSpace();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(olderServerResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(
      proxyUpdateSpace('space-1', { category_key: 'engineering' })
    ).rejects.toBeInstanceOf(UnsupportedSpaceCategoryPreferenceError);
  });

  it('accepts explicit category clearing when the server confirms it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(serverSpace(null)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(
      proxyCreateSpace({ name: 'Planning', category_key: null })
    ).resolves.toMatchObject({ categoryKey: null });
  });
});
