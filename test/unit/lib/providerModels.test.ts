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

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchProviderModels,
  loadCachedModels,
  saveCachedModels,
} from '@/lib/providerModels';

describe('provider model filtering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('limits Meta discovery results to the Muse Spark family', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'muse-voice-transcribe-1.0' },
            { id: 'muse-spark-1.3' },
            { id: 'muse-image-1.0' },
            { id: 'muse-spark-1.3-contributor' },
          ],
        }),
      })
    );

    const groups = await fetchProviderModels(
      'https://api.meta.ai/v1',
      '/models',
      'test-key',
      'muse-spark-'
    );

    expect(groups).toEqual([
      {
        provider: 'other',
        models: [
          { id: 'muse-spark-1.3' },
          { id: 'muse-spark-1.3-contributor' },
        ],
      },
    ]);
  });

  it('applies the provider filter to cached model lists', () => {
    saveCachedModels('meta', [
      {
        provider: 'other',
        models: [{ id: 'muse-image-1.0' }, { id: 'muse-spark-1.3' }],
      },
    ]);

    expect(loadCachedModels('meta', 'muse-spark-')).toEqual([
      { provider: 'other', models: [{ id: 'muse-spark-1.3' }] },
    ]);
  });
});
