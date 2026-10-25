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

import { pdfPreviewUrl } from '@/components/Folder/PdfPreview';
import { expect, it } from 'vitest';
it('retains authorization and gives the native viewer a filename and width fit', () => {
  const url = new URL(
    pdfPreviewUrl(
      'http://localhost:5001/files/stream?path=a%2Fb.pdf&project_id=p',
      '中文 report.pdf'
    )
  );
  expect(decodeURIComponent(url.pathname)).toBe(
    '/files/stream/中文 report.pdf'
  );
  expect(url.searchParams.get('path')).toBe('a/b.pdf');
  expect(url.hash).toBe('#view=FitH');
});
it('keeps signed remote URLs and explicit zoom intact', () => {
  expect(
    pdfPreviewUrl(
      'https://example.com/file?signature=secret#zoom=125',
      'report.pdf'
    )
  ).toBe('https://example.com/file?signature=secret#zoom=125');
});
it('leaves a URL it cannot parse unchanged', () => {
  expect(pdfPreviewUrl('', 'report.pdf')).toBe('');
  expect(pdfPreviewUrl('relative/report.pdf', 'report.pdf')).toBe(
    'relative/report.pdf'
  );
});
