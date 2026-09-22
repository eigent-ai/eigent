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

import { fetchWorkspaceCurrent } from '@/service/workspaceApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGet } = vi.hoisted(() => ({ fetchGet: vi.fn() }));
vi.mock('@/api/http', () => ({
  fetchGet,
  fetchPost: vi.fn(),
  fetchDelete: vi.fn(),
}));

describe('workspace binding lookup', () => {
  beforeEach(() => {
    fetchGet.mockReset();
  });

  it('keeps the existing identity query when no cancellation option is supplied', async () => {
    await fetchWorkspaceCurrent('space-one', 'user@example.invalid', 7);
    expect(fetchGet).toHaveBeenCalledWith('/workspace/current', {
      space_id: 'space-one',
      email: 'user@example.invalid',
      user_id: 7,
    });
  });

  it('passes cancellation to the transport without serializing it into the identity query', async () => {
    const controller = new AbortController();
    fetchGet.mockImplementation(
      (_path, _params, _headers, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    const request = fetchWorkspaceCurrent(
      'space-two',
      'user@example.invalid',
      null,
      {
        signal: controller.signal,
      }
    );
    const rejected = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejected;

    expect(fetchGet).toHaveBeenCalledWith(
      '/workspace/current',
      { space_id: 'space-two', email: 'user@example.invalid' },
      undefined,
      { signal: controller.signal }
    );
  });
});
