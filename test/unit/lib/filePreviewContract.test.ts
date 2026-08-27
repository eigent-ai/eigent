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
  FILE_PREVIEW_LIMITS,
} from '@/shared/filePreviewContract';
import { describe, expect, it } from 'vitest';

describe('file preview policy', () => {
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
