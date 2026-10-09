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

import { fetchPost, getBaseURL } from '@/api/http';
import {
  authorizeBrainFile,
  getBrainFilePreviewUrl,
  shareBrainFileAccess,
} from '@/lib/brainFileAccess';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchPost: vi.fn(), getBaseURL: vi.fn() }));

const BRAIN = 'http://localhost:5001';
const STREAM = `${BRAIN}/files/stream?path=site%2Findex.html&project_id=42&email=dev%40example.com`;
const GRANT = 'eyJ2IjoxfQ.c2lnbmF0dXJl';

function remoteFile(path: string): FileInfo {
  return { name: 'index.html', type: 'html', path, isRemote: true };
}

describe('authorizeBrainFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBaseURL).mockResolvedValue(BRAIN);
    vi.mocked(fetchPost).mockResolvedValue({
      access: GRANT,
      expires_at: 1,
    });
  });

  it('requests a grant for the file root and adds it to the URL', async () => {
    const file = remoteFile(`${STREAM}&space_id=space-1&user_id=7`);

    const authorized = await authorizeBrainFile(file);

    expect(fetchPost).toHaveBeenCalledWith('/files/access', {
      project_id: '42',
      email: 'dev@example.com',
      space_id: 'space-1',
      user_id: '7',
    });
    expect(authorized).toEqual({
      ...file,
      path: `${STREAM}&space_id=space-1&user_id=7&access=${GRANT}`,
    });
    expect(file.path).not.toContain('access=');
  });

  it('replaces an expired grant instead of appending a second one', async () => {
    const authorized = await authorizeBrainFile(
      remoteFile(`${STREAM}&access=old-grant`)
    );

    expect(new URL(authorized.path).searchParams.getAll('access')).toEqual([
      GRANT,
    ]);
  });

  it('keeps a same-origin Brain URL relative', async () => {
    vi.mocked(getBaseURL).mockResolvedValue('');
    const relative = '/files/stream?path=a.csv&project_id=42&email=a%40b.c';

    const authorized = await authorizeBrainFile(remoteFile(relative));

    expect(authorized.path).toBe(`${relative}&access=${GRANT}`);
  });

  it('leaves files that are not on the connected Brain untouched', async () => {
    const files = [
      remoteFile(STREAM.replace(BRAIN, 'https://brain.example.com')),
      remoteFile('https://storage.example.com/artifacts/report.pdf?sig=1'),
      remoteFile(`${BRAIN}/files/stream?path=a.csv`),
      { name: 'a.csv', type: 'csv', path: '/Users/dev/project/a.csv' },
      { ...remoteFile(STREAM), isFolder: true },
    ];

    for (const file of files) {
      await expect(authorizeBrainFile(file)).resolves.toBe(file);
    }
    expect(fetchPost).not.toHaveBeenCalled();
  });

  it('returns the file unchanged when no grant is issued', async () => {
    const file = remoteFile(STREAM);
    vi.mocked(fetchPost).mockRejectedValueOnce(new Error('HTTP 404'));
    await expect(authorizeBrainFile(file)).resolves.toBe(file);

    vi.mocked(fetchPost).mockResolvedValueOnce({});
    await expect(authorizeBrainFile(file)).resolves.toBe(file);
  });
});

describe('getBrainFilePreviewUrl', () => {
  it('puts the grant in the path so relative links keep it', () => {
    const previewUrl = getBrainFilePreviewUrl(
      `${BRAIN}/api/files/stream?path=x&project_id=42&email=dev%40example.com&space_id=s&access=${GRANT}`,
      'site/My Report/index.html'
    );

    expect(previewUrl).toBe(
      `${BRAIN}/api/files/preview/${GRANT}/site/My%20Report/index.html`
    );
    expect(new URL('assets/app.css', previewUrl).toString()).toBe(
      `${BRAIN}/api/files/preview/${GRANT}/site/My%20Report/assets/app.css`
    );
  });

  it('keeps the original preview route for a Brain without grants', () => {
    expect(
      getBrainFilePreviewUrl(
        `${STREAM}&space_id=space-1&user_id=7`,
        'site/index.html'
      )
    ).toBe(
      `${BRAIN}/files/preview/dev%40example.com/42/site/index.html?space_id=space-1&user_id=7`
    );
  });

  it('ignores URLs that are not Brain file streams', () => {
    expect(
      getBrainFilePreviewUrl('https://example.com/report.html', 'report.html')
    ).toBeUndefined();
    expect(getBrainFilePreviewUrl(STREAM, '')).toBeUndefined();
  });
});

describe('shareBrainFileAccess', () => {
  const selected = `${STREAM}&access=${GRANT}`;
  const sibling = `${BRAIN}/files/stream?path=site%2Fapp.css&project_id=42&email=dev%40example.com`;

  it('adds the grant to files under the same root', () => {
    expect(shareBrainFileAccess(sibling, selected)).toBe(
      `${sibling}&access=${GRANT}`
    );
  });

  it('does not share a grant with another root or origin', () => {
    for (const other of [
      sibling.replace('project_id=42', 'project_id=43'),
      `${sibling}&space_id=space-1`,
      sibling.replace(BRAIN, 'http://localhost:5002'),
    ]) {
      expect(shareBrainFileAccess(other, selected)).toBe(other);
    }
    expect(shareBrainFileAccess(sibling, STREAM)).toBe(sibling);
  });
});
