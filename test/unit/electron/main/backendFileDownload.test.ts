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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backendFileDownloadUrl,
  DOWNLOAD_BACKEND_FILE_CHANNEL,
} from '../../../../electron/main/backendFileDownload';

const PORT = 5001;
const query = 'path=big.pdf&project_id=p1&email=u%40e.com&access=G.1';

describe('backendFileDownloadUrl', () => {
  it.each([
    `http://localhost:${PORT}/files/stream?${query}`,
    `http://127.0.0.1:${PORT}/files/stream?${query}`,
    `http://localhost:${PORT}/files/stream/big.pdf?${query}`,
    `http://localhost:${PORT}/api/v1/files/stream?${query}`,
  ])('accepts a file on the local backend: %s', (url) => {
    expect(backendFileDownloadUrl(url, PORT)).toBe(url);
  });

  it.each([
    ['another site', `https://example.com/files/stream?${query}`],
    ['a look-alike host', `http://localhost.example.com:${PORT}/files/stream`],
    [
      'another local port',
      `http://localhost:${PORT + 1}/files/stream?${query}`,
    ],
    ['the default port', `http://localhost/files/stream?${query}`],
    ['https', `https://localhost:${PORT}/files/stream?${query}`],
    ['credentials', `http://user:pw@localhost:${PORT}/files/stream?${query}`],
    ['another backend route', `http://localhost:${PORT}/chat/p1/status`],
    ['the file listing', `http://localhost:${PORT}/files?${query}`],
    [
      'a path that climbs out',
      `http://localhost:${PORT}/files/stream/../../chat`,
    ],
    ['a nested path', `http://localhost:${PORT}/files/stream/a/b?${query}`],
    ['a local file', 'file:///etc/hosts'],
    ['a relative URL', `/files/stream?${query}`],
    ['a non-string', { href: `http://localhost:${PORT}/files/stream` }],
    ['nothing', undefined],
  ])('rejects %s', (_label, url) => {
    expect(backendFileDownloadUrl(url, PORT)).toBeNull();
  });
});

describe('backend file download wiring', () => {
  it('only downloads a validated URL for the app renderer', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );
    const start = source.indexOf(
      'ipcMain.handle(DOWNLOAD_BACKEND_FILE_CHANNEL'
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const handler = source.slice(start, source.indexOf('\n  });', start));

    expect(DOWNLOAD_BACKEND_FILE_CHANNEL).toBe('download-backend-file');
    expect(handler).toContain('assertAppRendererSender(event)');
    expect(handler).toContain('backendFileDownloadUrl(url, backendPort)');
    expect(handler).toContain('event.sender.downloadURL(downloadUrl)');
    expect(handler).not.toContain('downloadURL(url)');
  });
});
