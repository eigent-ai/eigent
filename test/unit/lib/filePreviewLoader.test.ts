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
  toLocalPreviewUrl,
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
  describe('bounded text completeness', () => {
    const limit = FILE_PREVIEW_LIMITS.textBytes;
    const file = {
      name: 'unsupported.xyz',
      type: 'xyz',
      path: 'https://files.example/unsupported.xyz',
      size: 10,
    };

    it('accepts the empty-file response to a Range request', async () => {
      const cancel = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(new ReadableStream({ cancel }), {
            status: 416,
            headers: { 'Content-Range': 'bytes */0' },
          })
        )
      );
      const result = await loadFilePreview(file, {});
      expect(result.content).toBe('');
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'complete',
        bytesRead: 0,
        totalBytes: 0,
      });
      expect(cancel).toHaveBeenCalledOnce();
    });

    it.each(['bytes */10', 'bytes */*'])(
      'does not mistake a range failure (%s) for an empty file',
      async (range) => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(
            new Response(null, {
              status: 416,
              headers: { 'Content-Range': range },
            })
          )
        );
        await expect(loadFilePreview(file, {})).rejects.toThrow('HTTP 416');
      }
    );

    it('does not promote a partial full-mode response using stale listing bytes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('weird ext\n', {
            status: 206,
            headers: {
              'Content-Range': 'bytes 0-9/*',
              'Content-Length': '10',
            },
          })
        )
      );
      const result = await loadFilePreview(
        { ...file, name: 'file.txt', type: 'txt' },
        {}
      );
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'unknown',
        bytesRead: 10,
        totalBytes: null,
      });
    });

    it.each([
      { content: 'weird ext\n', totalBytes: 10, completeness: 'complete' },
      { content: '', totalBytes: 0, completeness: 'complete' },
      { content: 'weird ext\n', totalBytes: null, completeness: 'unknown' },
      {
        content: 'x'.repeat(limit),
        totalBytes: limit + 1,
        completeness: 'truncated',
      },
    ])(
      'classifies desktop byte facts ($totalBytes, $completeness)',
      async ({ content, totalBytes, completeness }) => {
        const bytesRead = new TextEncoder().encode(content).length;
        const invoke = vi
          .fn()
          .mockResolvedValueOnce({ size: totalBytes })
          .mockResolvedValueOnce({
            content,
            bytesRead,
            totalBytes,
            binary: false,
          });
        const result = await loadFilePreview(
          { ...file, path: '/workspace/unsupported.xyz' },
          { ipcRenderer: { invoke } }
        );
        expect(result.content).toBe(content);
        expect(result.preview).toEqual({
          kind: 'text',
          completeness,
          bytesRead,
          totalBytes,
        });
        expect(invoke).toHaveBeenLastCalledWith(
          'preview-text-file',
          '/workspace/unsupported.xyz',
          limit
        );
      }
    );

    it.each([
      {
        status: 200,
        content: 'weird ext\n',
        headers: { 'Content-Length': '10' },
        completeness: 'complete',
        totalBytes: 10,
      },
      {
        status: 200,
        content: '',
        headers: { 'Content-Length': '0' },
        completeness: 'complete',
        totalBytes: 0,
      },
      {
        status: 200,
        content: 'weird ext\n',
        headers: {},
        completeness: 'complete',
        totalBytes: null,
      },
      {
        status: 200,
        content: '',
        headers: {},
        completeness: 'complete',
        totalBytes: null,
      },
      {
        status: 200,
        content: 'x'.repeat(limit),
        headers: {},
        completeness: 'complete',
        totalBytes: null,
      },
      {
        status: 200,
        content: 'x'.repeat(limit + 1),
        headers: {},
        completeness: 'truncated',
        totalBytes: null,
      },
      {
        status: 206,
        content: 'weird ext\n',
        headers: { 'Content-Range': 'bytes 0-9/10', 'Content-Length': '10' },
        completeness: 'complete',
        totalBytes: 10,
      },
      {
        status: 206,
        content: 'weird ext\n',
        headers: { 'Content-Range': 'bytes 0-9/20', 'Content-Length': '10' },
        completeness: 'truncated',
        totalBytes: 20,
      },
      {
        status: 206,
        content: 'weird ext\n',
        headers: { 'Content-Range': 'bytes 0-9/*', 'Content-Length': '10' },
        completeness: 'unknown',
        totalBytes: null,
      },
      {
        status: 206,
        content: 'x'.repeat(limit + 1),
        headers: { 'Content-Range': `bytes 0-${limit}/*` },
        completeness: 'truncated',
        totalBytes: null,
      },
    ])(
      'classifies HTTP response facts over stale metadata (%#, $completeness)',
      async ({ status, content, headers, completeness, totalBytes }) => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            new Response(content, { status, headers: headers as HeadersInit })
          );
        vi.stubGlobal('fetch', fetchMock);
        const result = await loadFilePreview(file, {});
        expect(result.content).toBe(content.slice(0, limit));
        expect(result.preview).toEqual({
          kind: 'text',
          completeness,
          bytesRead: Math.min(content.length, limit),
          totalBytes,
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(
          file.path,
          expect.objectContaining({ headers: { Range: `bytes=0-${limit}` } })
        );
      }
    );

    it('cancels an unbounded response after at most one lookahead byte', async () => {
      const cancel = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('x'.repeat(limit * 2))
                );
              },
              cancel,
            })
          )
        )
      );
      const result = await loadFilePreview(file, {});
      expect(result.content).toHaveLength(limit);
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'truncated',
        bytesRead: limit,
        totalBytes: null,
      });
      expect(cancel).toHaveBeenCalledOnce();
    });
  });

  it.each(['docx', 'xlsx', 'pptx'])(
    'parses a bounded remote %s archive through the Electron host',
    async (type) => {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(bytes, {
            headers: {
              'Content-Length': String(bytes.byteLength),
              'Content-Type': 'application/zip',
            },
          })
        )
      );
      const invoke = vi.fn().mockResolvedValue('<p>Office preview</p>');

      const result = await loadFilePreview(
        {
          name: `report.${type}`,
          type,
          path: `https://files.example/report.${type}`,
          size: bytes.byteLength,
          mimeType: 'application/zip',
          isRemote: true,
        },
        { ipcRenderer: { invoke } }
      );

      expect(result.content).toBe('<p>Office preview</p>');
      expect(result.preview).toBeUndefined();
      expect(invoke).toHaveBeenCalledWith('preview-office-buffer', type, bytes);
    }
  );

  it.each([4, 10])('fully loads a %i MiB remote HTML document', async (mib) => {
    const size = mib * 1024 * 1024;
    const content = `<html>${' '.repeat(size - 13)}</html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(content, { headers: { 'Content-Length': String(size) } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadFilePreview(
      {
        name: 'index.html',
        type: 'html',
        path: 'https://files.example/index.html',
        size,
      },
      {}
    );

    expect(result.content?.length).toBe(size);
    expect(result.content === content).toBe(true);
    expect(result.preview).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://files.example/index.html',
      expect.objectContaining({ headers: { Range: 'bytes=0-10485760' } })
    );
  });

  it.each([6, 12])(
    'uses the response total for partial HTML with stale 4 MiB metadata and a %i MiB total',
    async (totalMib) => {
      const bodySize = 4 * 1024 * 1024;
      const totalBytes = totalMib * 1024 * 1024;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('x'.repeat(bodySize), {
            status: 206,
            headers: {
              'Content-Range': `bytes 0-${bodySize - 1}/${totalBytes}`,
              'Content-Length': String(bodySize),
            },
          })
        )
      );

      const result = await loadFilePreview(
        {
          name: 'index.html',
          type: 'html',
          path: 'https://files.example/index.html',
          size: bodySize,
        },
        {}
      );

      expect(result.content).toHaveLength(1024 * 1024);
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'truncated',
        bytesRead: 1024 * 1024,
        totalBytes,
      });
    }
  );

  it.each([4, 6])(
    'keeps partial HTML with an unknown response total as source despite %i MiB metadata',
    async (metadataMib) => {
      const bodySize = 4 * 1024 * 1024;
      const metadataSize = metadataMib * 1024 * 1024;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('x'.repeat(bodySize), {
            status: 206,
            headers: {
              'Content-Range': `bytes 0-${bodySize - 1}/*`,
              'Content-Length': String(bodySize),
            },
          })
        )
      );

      const result = await loadFilePreview(
        {
          name: 'index.html',
          type: 'html',
          path: 'https://files.example/index.html',
          size: metadataSize,
        },
        {}
      );

      expect(result.content).toHaveLength(1024 * 1024);
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'truncated',
        bytesRead: 1024 * 1024,
        totalBytes: null,
      });
    }
  );

  it('fully previews a complete response when older metadata overstates its size', async () => {
    const content = '<html>complete</html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(content, {
          headers: { 'Content-Length': String(content.length) },
        })
      )
    );

    const result = await loadFilePreview(
      {
        name: 'index.html',
        type: 'html',
        path: 'https://files.example/index.html',
        size: 4 * 1024 * 1024,
      },
      {}
    );

    expect(result.content).toBe(content);
    expect(result.preview).toBeUndefined();
  });

  it.each([4 * 1024 * 1024, 10 * 1024 * 1024, 10 * 1024 * 1024 + 1, null])(
    'routes local HTML of size %s through the appropriate authorized reader',
    async (size) => {
      const full = size !== null && size <= 10 * 1024 * 1024;
      const invoke = vi
        .fn()
        .mockResolvedValueOnce({ size, mimeType: 'text/html' })
        .mockResolvedValueOnce(
          full
            ? '<html>complete</html>'
            : {
                content: '<html>excerpt',
                bytesRead: 13,
                totalBytes: size,
              }
        );
      const result = await loadFilePreview(
        { name: 'index.html', type: 'html', path: '/workspace/index.html' },
        { ipcRenderer: { invoke } }
      );

      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenNthCalledWith(
        1,
        'get-file-preview-metadata',
        '/workspace/index.html'
      );
      if (full) {
        expect(invoke).toHaveBeenNthCalledWith(
          2,
          'open-file',
          'html',
          '/workspace/index.html',
          undefined
        );
        expect(result.preview).toBeUndefined();
      } else {
        expect(invoke).toHaveBeenNthCalledWith(
          2,
          'preview-text-file',
          '/workspace/index.html',
          1024 * 1024
        );
        expect(result.preview).toMatchObject({
          kind: 'text',
          completeness: size === null ? 'unknown' : 'truncated',
        });
      }
    }
  );

  it.each([10 * 1024 * 1024 + 1, undefined])(
    'bounds remote HTML source to 1 MiB when size is %s even if Range is ignored',
    async (size) => {
      const cancel = vi.fn();
      const fetchMock = vi.fn().mockImplementation((_url, options) => {
        if (
          options.method === 'HEAD' ||
          options.headers?.Range === 'bytes=0-0'
        ) {
          return Promise.resolve(new Response(null));
        }
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('x'.repeat(2 * 1024 * 1024))
                );
              },
              cancel,
            })
          )
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await loadFilePreview(
        {
          name: 'index.html',
          type: 'html',
          path: 'https://files.example/index.html',
          size,
        },
        {}
      );

      expect(result.content).toHaveLength(1024 * 1024);
      expect(result.preview).toEqual({
        kind: 'text',
        completeness: 'truncated',
        bytesRead: 1024 * 1024,
        totalBytes: null,
      });
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://files.example/index.html',
        expect.objectContaining({ headers: { Range: 'bytes=0-1048576' } })
      );
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  );

  it.each([2 * 1024 * 1024, 10 * 1024 * 1024 + 1])(
    'uses response EOF and the byte budget for an unexpected %i byte HTML response',
    async (actualSize) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('x'.repeat(actualSize)))
      );
      const result = await loadFilePreview(
        {
          name: 'index.html',
          type: 'html',
          path: 'https://files.example/index.html',
          size: 4 * 1024 * 1024,
        },
        {}
      );

      if (actualSize <= FILE_PREVIEW_LIMITS.richHtmlBytes) {
        expect(result.content).toHaveLength(actualSize);
        expect(result.preview).toBeUndefined();
      } else {
        expect(result.content).toHaveLength(FILE_PREVIEW_LIMITS.textBytes);
        expect(result.preview).toMatchObject({
          kind: 'text',
          completeness: 'truncated',
          bytesRead: FILE_PREVIEW_LIMITS.textBytes,
        });
      }
    }
  );

  it.each([
    { type: 'mp4', mimeType: 'video/mp4' },
    { type: 'blend', mimeType: 'application/octet-stream' },
  ])(
    'authorizes $type metadata without reading it as text or fetching HTTP',
    async ({ type, mimeType }) => {
      const invoke = vi.fn().mockResolvedValue({ size: 2048, mimeType });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await loadFilePreview(
        { name: `final.${type}`, path: `/workspace/final.${type}`, type },
        { ipcRenderer: { invoke } }
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith(
        'get-file-preview-metadata',
        `/workspace/final.${type}`
      );
      expect(fetchMock).not.toHaveBeenCalled();
      if (type === 'blend') {
        expect(result.content).toBeUndefined();
        expect(result.preview).toMatchObject({
          kind: 'blocked',
          reason: 'unsupported',
        });
      } else {
        expect(result.content).toBe(toLocalPreviewUrl('/workspace/final.mp4'));
        expect(result.preview).toBeUndefined();
      }
    }
  );

  it('does not use HTTP after local metadata authorization fails', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue(
        new Error('Preview file is outside the active workspace')
      );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      loadFilePreview(
        { name: 'final.mp4', path: '/outside/final.mp4', type: 'mp4' },
        { ipcRenderer: { invoke } }
      )
    ).rejects.toThrow('outside the active workspace');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an absolute local path out of the custom URL hostname', () => {
    expect(toLocalPreviewUrl('/Users/Example User/report.pdf')).toBe(
      'localfile://preview/?path=%2FUsers%2FExample%20User%2Freport.pdf'
    );
  });

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
    expect(result.content).toBe(
      'localfile://preview/?path=%2Fworkspace%2Freport.pdf'
    );
    expect(result.preview).toMatchObject({ kind: 'range-pdf', size: 1024 });
  });

  it('uses the workspace-scoped protocol for local media previews', async () => {
    const invoke = vi.fn().mockResolvedValue({
      size: 1024,
      mimeType: 'image/png',
      supportsRanges: true,
    });

    const result = await loadFilePreview(
      { name: 'preview.png', type: 'png', path: '/workspace/preview.png' },
      { ipcRenderer: { invoke } }
    );

    expect(invoke).toHaveBeenCalledWith(
      'get-file-preview-metadata',
      '/workspace/preview.png'
    );
    expect(result.content).toBe(
      'localfile://preview/?path=%2Fworkspace%2Fpreview.png'
    );
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
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { Range: 'bytes=0-0' },
      })
    );
    expect(result.preview).toMatchObject({ kind: 'range-pdf', size: 2048 });
    expect(result.content).toBe('https://files.example/remote.pdf');
  });

  it('does not send browser credentials to a cross-port local Brain preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode('<h1>preview</h1>'), {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-15/16',
          'Content-Type': 'text/html',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadFilePreview(
      {
        name: 'index.html',
        type: 'html',
        path: 'http://localhost:5001/files/stream?path=index.html',
        size: 16,
        isRemote: true,
      },
      {}
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/files/stream?path=index.html',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    expect(result.content).toContain('<h1>preview</h1>');
  });

  it('never sends an HTTP Brain preview URL through the local file IPC channel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode('# preview'), {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-8/9',
          'Content-Type': 'text/markdown',
        },
      })
    );
    const invoke = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadFilePreview(
      {
        name: 'todo.md',
        type: 'md',
        path: 'http://localhost:5001/files/stream?path=todo.md',
        size: 9,
      },
      { ipcRenderer: { invoke } }
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/files/stream?path=todo.md',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    expect(result.content).toBe('# preview');
  });
});

describe('unsupported file recovery', () => {
  it.each(['zip', 'gz', 'tar', 'rar', '7z'])(
    'never reads a local %s archive',
    async (type) => {
      const invoke = vi.fn().mockResolvedValue({ size: 1024 });
      const file = await loadFilePreview(
        { name: `file.${type}`, type, path: `/workspace/file.${type}` },
        { ipcRenderer: { invoke } }
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(file.preview).toMatchObject({
        kind: 'blocked',
        reason: 'unsupported',
      });
    }
  );
  it('blocks binary content returned by the desktop bounded reader', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ size: 100 })
      .mockResolvedValueOnce({
        binary: true,
        content: '',
        bytesRead: 100,
        totalBytes: 100,
      });
    const file = await loadFilePreview(
      {
        name: 'data.unknown',
        type: 'unknown',
        path: '/workspace/data.unknown',
      },
      { ipcRenderer: { invoke } }
    );
    expect(file.content).toBeUndefined();
    expect(file.preview?.kind).toBe('blocked');
  });
  it.each([
    {
      content: `${'A'.repeat(9000)}\ncafé\n`,
      expected: `${'A'.repeat(9000)}\ncafé\n`,
    },
    {
      content:
        'before\n\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\\nERROR: job failed\n',
      expected: 'before\nlink\nERROR: job failed\n',
    },
  ])(
    'preserves decoded remote subtitle content %#',
    async ({ content, expected }) => {
      const bytes = new Uint8Array(Buffer.from(content, 'latin1'));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
      const file = await loadFilePreview(
        {
          name: 'subtitles.srt',
          path: 'https://files.example/subtitles.srt',
          type: 'srt',
          size: bytes.length,
        },
        {}
      );

      expect(file.content).toBe(expected);
      expect(file.preview).toEqual({
        kind: 'text',
        completeness: 'complete',
        bytesRead: bytes.length,
        totalBytes: null,
      });
    }
  );
  it.each([
    { bytes: new Uint8Array([31, 139, 8, 0, 0, 1]), blocked: true },
    { bytes: new TextEncoder().encode('Hello 世界\n'), blocked: false },
    { bytes: new Uint8Array([255, 254, 72, 0, 105, 0]), blocked: false },
  ])(
    'probes unknown remote bytes before decoding ($blocked)',
    async ({ bytes, blocked }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
      const file = await loadFilePreview(
        {
          name: 'download',
          path: 'https://files.example/download',
          type: '',
          size: bytes.length,
        },
        {}
      );
      expect(file.preview?.kind).toBe(blocked ? 'blocked' : 'text');
      if (!blocked) expect(file.content).toMatch(/Hello|Hi/);
    }
  );
});
