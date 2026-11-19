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

import type { SharedSessionSnapshot } from '@/lib/sessionShare/buildSharedSession';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  proxyFetchGet: vi.fn(),
  proxyFetchPost: vi.fn(),
  proxyFetchPatch: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));

vi.mock('@/api/http', () => http);

import {
  createSharedSessionLink,
  deleteSharedSessionLink,
  listSharedSessionLinks,
  parseSharedSessionLink,
  SharedSessionUnavailableError,
  stopSharedSessionLink,
  updateSharedSessionExpiry,
} from '@/service/sharedSessionApi';

const snapshot: SharedSessionSnapshot = {
  schema_version: 1,
  title: 'Q3 report',
  runs: [],
  included: { tool_calls: true, thinking: false, files: [] },
};

const link = {
  share_id: 'abc123',
  url: 'https://share.example.test/s/abc123',
  title: 'Q3 report',
  created_at: '2026-11-01T10:00:00Z',
  expires_at: '2026-11-08T10:00:00Z',
  stopped: false,
  version: 1,
};

describe('sharedSessionApi', () => {
  beforeEach(() => {
    Object.values(http).forEach((fn) => fn.mockReset());
  });

  it('creates a link with the snapshot and expiry', async () => {
    http.proxyFetchPost.mockResolvedValue(link);
    const created = await createSharedSessionLink({
      projectId: 'project-1',
      snapshot,
      expiresInDays: 7,
    });
    expect(http.proxyFetchPost).toHaveBeenCalledWith(
      '/api/v1/shared-sessions',
      {
        project_id: 'project-1',
        title: 'Q3 report',
        expires_in_days: 7,
        snapshot,
      }
    );
    expect(created).toEqual({
      shareId: 'abc123',
      url: link.url,
      title: 'Q3 report',
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      stopped: false,
      version: 1,
    });
  });

  it('publishes a new version under an existing link', async () => {
    http.proxyFetchPost.mockResolvedValue({ ...link, version: 2 });
    await createSharedSessionLink({
      projectId: 'project-1',
      snapshot,
      expiresInDays: null,
      shareId: 'abc123',
    });
    expect(http.proxyFetchPost.mock.calls[0][1]).toMatchObject({
      share_id: 'abc123',
      expires_in_days: null,
    });
  });

  it('reports a server without sharing as unavailable', async () => {
    http.proxyFetchPost.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    );
    await expect(
      createSharedSessionLink({
        projectId: 'project-1',
        snapshot,
        expiresInDays: 1,
      })
    ).rejects.toBeInstanceOf(SharedSessionUnavailableError);
  });

  it('passes other failures through', async () => {
    const failure = Object.assign(new Error('nope'), { status: 500 });
    http.proxyFetchGet.mockRejectedValue(failure);
    await expect(listSharedSessionLinks('project-1')).rejects.toBe(failure);
  });

  it('lists the owner links for a Session and skips malformed rows', async () => {
    http.proxyFetchGet.mockResolvedValue({
      items: [link, { share_id: 'x' }, { ...link, share_id: 'def' }],
    });
    const links = await listSharedSessionLinks('project-1');
    expect(http.proxyFetchGet).toHaveBeenCalledWith('/api/v1/shared-sessions', {
      project_id: 'project-1',
    });
    expect(links.map((item) => item.shareId)).toEqual(['abc123', 'def']);
  });

  it('stops, re-dates and deletes a link by id', async () => {
    http.proxyFetchPost.mockResolvedValue({ ...link, stopped: true });
    http.proxyFetchPatch.mockResolvedValue({ ...link, expires_at: null });
    http.proxyFetchDelete.mockResolvedValue({ code: 0 });

    expect((await stopSharedSessionLink('abc/123')).stopped).toBe(true);
    expect(http.proxyFetchPost).toHaveBeenCalledWith(
      '/api/v1/shared-sessions/abc%2F123/stop'
    );
    expect((await updateSharedSessionExpiry('abc123', null)).expiresAt).toBe(
      null
    );
    expect(http.proxyFetchPatch).toHaveBeenCalledWith(
      '/api/v1/shared-sessions/abc123',
      { expires_in_days: null }
    );
    await deleteSharedSessionLink('abc123');
    expect(http.proxyFetchDelete).toHaveBeenCalledWith(
      '/api/v1/shared-sessions/abc123'
    );
  });

  it('rejects a link that is not an http(s) URL', () => {
    expect(() =>
      parseSharedSessionLink({ ...link, url: 'javascript:alert(1)' })
    ).toThrow();
  });
});
