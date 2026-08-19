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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: http.get,
  fetchPost: http.post,
  fetchPatch: http.patch,
  fetchDelete: http.del,
}));

import {
  archiveMemoryEntry,
  createMemoryEntry,
  listMemoryEntries,
  listMemoryScopeSummaries,
  updateMemoryScopeSettings,
} from '@/service/memoryApi';

describe('local Memory API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });
  });

  it('uses unprefixed local Brain paths', async () => {
    http.get.mockResolvedValue({ items: [] });
    http.post.mockResolvedValue({});
    http.patch.mockResolvedValue({});

    await listMemoryEntries('project', 'project-1');
    await listMemoryScopeSummaries([
      { scopeType: 'space', scopeId: 'space-1' },
      { scopeType: 'project', scopeId: 'project-1' },
    ]);
    await createMemoryEntry('project', 'project-1', {
      kind: 'fact',
      content: 'Use ISO dates.',
      reason: 'user setting',
    });
    await updateMemoryScopeSettings('space', 'space-1', {
      expectedRevision: 2,
      captureEnabled: false,
    });
    await archiveMemoryEntry({
      memory_id: 'memory-1',
      version: 3,
    } as never);

    expect(http.get).toHaveBeenCalledWith('/memory/entries', {
      scope_type: 'project',
      scope_id: 'project-1',
      include_deleted: false,
    });
    expect(http.post.mock.calls[0]).toEqual([
      '/memory/scopes/summaries',
      {
        scopes: [
          { scope_type: 'space', scope_id: 'space-1' },
          { scope_type: 'project', scope_id: 'project-1' },
        ],
      },
    ]);
    expect(http.post.mock.calls[1][0]).toBe(
      '/memory/entries?scope_type=project&scope_id=project-1'
    );
    expect(http.patch.mock.calls[0][0]).toBe(
      '/memory/scopes/space/space-1/settings'
    );
    expect(http.del.mock.calls[0][0]).toBe('/memory/entries/memory-1');
    expect(http.get.mock.calls.flat().join(' ')).not.toContain('/api/v1');
  });
});
