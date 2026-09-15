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

import { readPdfRange } from '@/lib/pdfPreviewRange';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;
describe('PDF range reader', () => {
  it('reads only the requested bytes with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 206,
        headers: { 'Content-Range': 'bytes 2-3/4' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await readPdfRange('localfile://preview/?path=a.pdf', 2, 4, 4, signal)
    ).toEqual(new Uint8Array([1, 2]));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      signal,
      credentials: 'same-origin',
      headers: { Range: 'bytes=2-3' },
    });
  });
  it.each([
    { status: 403, header: '', bytes: [1, 2] },
    { status: 200, header: '', bytes: [1, 2, 3, 4] },
    { status: 206, header: 'bytes 2-3/8', bytes: [1, 2] },
    { status: 206, header: 'bytes 2-3/4', bytes: [1] },
    { status: 206, header: 'bytes 2-3/4', bytes: [1, 2, 3] },
  ])(
    'rejects denied, ignored, changed or malformed ranges ($status $header)',
    async ({ status, header, bytes }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(new Uint8Array(bytes), {
            status,
            headers: { 'Content-Range': header },
          })
        )
      );
      await expect(readPdfRange('/a.pdf', 2, 4, 4, signal)).rejects.toThrow();
    }
  );
  it('rejects oversized metadata without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      readPdfRange('/a.pdf', 0, 2, FILE_PREVIEW_LIMITS.pdfBytes + 1, signal)
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
