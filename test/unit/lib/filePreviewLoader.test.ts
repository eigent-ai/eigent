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
  loadFilePreview,
  parseBoundedCsvPreview,
} from '@/lib/filePreviewLoader';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseBoundedCsvPreview', () => {
  it('caps rows, columns and individual cell length', () => {
    const headers = Array.from(
      { length: FILE_PREVIEW_LIMITS.csvColumns + 1 },
      (_, index) => `column_${index}`
    );
    const longCell = 'x'.repeat(FILE_PREVIEW_LIMITS.csvCellCharacters + 10);
    const rows = Array.from({ length: FILE_PREVIEW_LIMITS.csvRows + 1 }, () =>
      [longCell, ...headers.slice(1).map(() => 'value')].join(',')
    );

    const preview = parseBoundedCsvPreview(
      [headers.join(','), ...rows].join('\n'),
      { bytesRead: 10, totalBytes: 20 }
    );

    expect(preview.columns).toHaveLength(FILE_PREVIEW_LIMITS.csvColumns);
    expect(preview.rows).toHaveLength(FILE_PREVIEW_LIMITS.csvRows);
    expect(preview.rows[0][0]).toHaveLength(
      FILE_PREVIEW_LIMITS.csvCellCharacters + 1
    );
    expect(preview.truncated).toBe(true);
  });
});

describe('loadFilePreview', () => {
  it('uses metadata then returns a range URL without reading PDF content', async () => {
    const invoke = vi.fn().mockResolvedValue({
      size: 1024,
      mimeType: 'application/pdf',
      supportsRanges: true,
    });

    const result = await loadFilePreview(
      { name: 'report.pdf', type: 'pdf', path: '/workspace/report.pdf' },
      { ipcRenderer: { invoke } }
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'get-file-preview-metadata',
      '/workspace/report.pdf'
    );
    expect(result.content).toBe('localfile:///workspace/report.pdf');
    expect(result.preview).toMatchObject({ kind: 'range-pdf', size: 1024 });
  });

  it('does not invoke any content reader for an oversized PDF', async () => {
    const invoke = vi.fn().mockResolvedValue({
      size: FILE_PREVIEW_LIMITS.pdfBytes + 1,
      supportsRanges: true,
    });

    const result = await loadFilePreview(
      { name: 'huge.pdf', type: 'pdf', path: '/workspace/huge.pdf' },
      { ipcRenderer: { invoke } }
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.content).toBeUndefined();
    expect(result.preview).toMatchObject({
      kind: 'blocked',
      reason: 'too-large',
    });
  });

  it('falls back to a one-byte Range probe when remote metadata is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([37]), {
          status: 206,
          headers: {
            'Content-Range': 'bytes 0-0/2048',
            'Content-Type': 'application/pdf',
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadFilePreview(
      {
        name: 'remote.pdf',
        type: 'pdf',
        path: 'https://files.example/remote.pdf',
        isRemote: true,
      },
      {}
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://files.example/remote.pdf',
      expect.objectContaining({ headers: { Range: 'bytes=0-0' } })
    );
    expect(result.preview).toMatchObject({ kind: 'range-pdf', size: 2048 });
    expect(result.content).toBe('https://files.example/remote.pdf');
  });
});
