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
  decideFilePreview,
  decodePreviewText,
  FILE_PREVIEW_LIMITS,
} from '@/shared/filePreviewContract';
import { describe, expect, it } from 'vitest';

describe('file preview policy', () => {
  it.each([1024 * 1024 + 1, 4 * 1024 * 1024, 10 * 1024 * 1024])(
    'fully previews HTML of %i bytes within the 10 MiB limit',
    (size) => {
      expect(decideFilePreview('html', { size })).toEqual({
        mode: 'full',
        limit: 10 * 1024 * 1024,
      });
    }
  );

  it.each([10 * 1024 * 1024 + 1, null])(
    'limits HTML source excerpts to 1 MiB when size is %s',
    (size) => {
      expect(decideFilePreview('html', { size })).toEqual({
        mode: 'bounded-text',
        limit: 1024 * 1024,
      });
    }
  );

  it.each(['txt', 'md', 'json'])(
    'preserves the 1 MiB full-preview boundary for %s',
    (type) => {
      expect(decideFilePreview(type, { size: 1024 * 1024 })).toEqual({
        mode: 'full',
        limit: 1024 * 1024,
      });
      expect(decideFilePreview(type, { size: 1024 * 1024 + 1 })).toEqual({
        mode: 'bounded-text',
        limit: 1024 * 1024,
      });
    }
  );

  it('streams MP4 media but blocks native Blender projects as unsupported', () => {
    expect(decideFilePreview('mp4', { size: 30_000_000 })).toEqual({
      mode: 'stream-media',
      limit: null,
    });
    for (const type of ['blend', '.BLEND']) {
      expect(decideFilePreview(type, { size: 30_000_000 })).toEqual({
        mode: 'blocked',
        reason: 'unsupported',
        limit: null,
      });
    }
  });

  it('always routes CSV through the bounded reader', () => {
    expect(decideFilePreview('csv', { size: 2_000_000_000 })).toMatchObject({
      mode: 'bounded-csv',
      limit: FILE_PREVIEW_LIMITS.csvScanBytes,
    });
  });

  it('blocks PDFs whose size cannot be verified', () => {
    expect(decideFilePreview('pdf', { size: null })).toMatchObject({
      mode: 'blocked',
      reason: 'metadata-unavailable',
    });
  });

  it('blocks PDFs above the hard limit and ranges smaller PDFs', () => {
    expect(
      decideFilePreview('application/pdf', {
        size: FILE_PREVIEW_LIMITS.pdfBytes + 1,
      })
    ).toMatchObject({ mode: 'blocked', reason: 'too-large' });
    expect(
      decideFilePreview('pdf', { size: FILE_PREVIEW_LIMITS.pdfBytes })
    ).toMatchObject({ mode: 'range-pdf' });
  });

  it('blocks PDF embedding when byte ranges are explicitly unsupported', () => {
    expect(
      decideFilePreview('pdf', { size: 1024, supportsRanges: false })
    ).toMatchObject({ mode: 'blocked', reason: 'unsupported' });
  });

  it('uses a bounded text reader for large markdown', () => {
    expect(
      decideFilePreview('md', { size: FILE_PREVIEW_LIMITS.textBytes + 1 })
    ).toMatchObject({ mode: 'bounded-text' });
  });

  it('never fully decodes an unknown file in the renderer', () => {
    expect(decideFilePreview('custom-data', { size: 20 })).toMatchObject({
      mode: 'bounded-text',
      limit: FILE_PREVIEW_LIMITS.textBytes,
    });
    expect(
      decideFilePreview('custom-data', {
        size: FILE_PREVIEW_LIMITS.defaultBytes,
      })
    ).toMatchObject({ mode: 'bounded-text' });
  });
});

describe('binary preview detection', () => {
  it.each(['zip', '.GZ', 'tar.gz', '7z', 'rar', 'tar', 'application/zip'])(
    'blocks %s without decoding',
    (type) => {
      expect(decideFilePreview(type, { size: 48_000_000 })).toMatchObject({
        mode: 'blocked',
        reason: 'unsupported',
      });
    }
  );
  it('uses archive MIME even when the extension is unknown', () => {
    expect(
      decideFilePreview('download', {
        size: 10,
        mimeType: 'application/gzip; charset=binary',
      })
    ).toMatchObject({ mode: 'blocked' });
  });

  it.each(['docx', 'xlsx', 'pptx'])(
    'keeps the %s extension previewable when a server reports application/zip',
    (type) => {
      expect(
        decideFilePreview(type, {
          size: 1024,
          mimeType: 'application/zip',
        })
      ).toMatchObject({ mode: 'full', limit: FILE_PREVIEW_LIMITS.officeBytes });
    }
  );
});

describe('text preview decoding', () => {
  it('strips ANSI color sequences without classifying logs as binary', () => {
    expect(
      decodePreviewText(new TextEncoder().encode('\u001b[31mERROR\u001b[0m\n'))
    ).toBe('ERROR\n');
  });

  it.each([
    ['BEL', '\u0007', '\u0007'],
    ['ST', '\u001b\\', '\u001b\\'],
    ['ST then BEL', '\u001b\\', '\u0007'],
    ['BEL then ST', '\u0007', '\u001b\\'],
  ])(
    'preserves OSC8 labels and following logs with %s terminators',
    (_, open, close) => {
      const input = `before\n\u001b]8;;https://example.com${open}link\u001b]8;;${close}\nafter\nERROR: job failed\n`;

      expect(decodePreviewText(new TextEncoder().encode(input))).toBe(
        'before\nlink\nafter\nERROR: job failed\n'
      );
    }
  );

  it.each(['\u0007', '\u001b\\'])(
    'stops a title OSC at its first terminator %j',
    (terminator) => {
      const input = `before\u001b]0;title${terminator}after\n`;
      expect(decodePreviewText(new TextEncoder().encode(input))).toBe(
        'beforeafter\n'
      );
    }
  );

  it.each(['\n', ''])(
    'falls back to Windows-1252 after a long ASCII prefix with trailing %j',
    (ending) => {
      const prefix = `${'A'.repeat(9000)}\ncaf`;
      const bytes = new Uint8Array([
        ...new TextEncoder().encode(prefix),
        0xe9,
        ...new TextEncoder().encode(ending),
      ]);

      expect(decodePreviewText(bytes)).toBe(`${prefix}é${ending}`);
    }
  );

  it.each([8192, 9000])(
    'recognizes GB18030 after %i ASCII bytes',
    (prefixLength) => {
      const prefix = 'A'.repeat(prefixLength);
      const bytes = new Uint8Array([
        ...new TextEncoder().encode(prefix),
        0xd6,
        0xd0,
        0xce,
        0xc4,
        0x0a,
      ]);

      expect(decodePreviewText(bytes)).toBe(`${prefix}中文\n`);
    }
  );

  it('preserves UTF-8 characters crossing the former sample boundary', () => {
    const content = `${'A'.repeat(8191)}中文\n`;
    expect(decodePreviewText(new TextEncoder().encode(content))).toBe(content);
  });

  it('still rejects binary controls after a long ASCII prefix', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('A'.repeat(9000)),
      0x00,
      0x01,
    ]);
    expect(decodePreviewText(bytes)).toBeNull();
  });

  it('decodes common GBK and Latin-1 text', () => {
    expect(decodePreviewText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe(
      '中文'
    );
    expect(decodePreviewText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe(
      'café'
    );
  });

  it('keeps complete text when the file ends mid-character', () => {
    expect(decodePreviewText(new Uint8Array([0x41, 0xe4, 0xb8]))).toBe('A');
  });

  it('still rejects binary control bytes', () => {
    expect(decodePreviewText(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });
});
