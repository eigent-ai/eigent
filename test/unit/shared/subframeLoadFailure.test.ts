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
  isSameFrameUrl,
  isSubframeLoadFailure,
  SUBFRAME_LOAD_FAILED_CHANNEL,
  subframeLoadFailureFromEvent,
} from '@/shared/subframeLoadFailure';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pdfUrl =
  'http://localhost:5001/files/stream?path=e2e-artifacts%2Freport.pdf&project_id=p1';

describe('subframe load failures', () => {
  it('forwards a blocked embedded frame', () => {
    // ERR_BLOCKED_BY_RESPONSE, e.g. X-Frame-Options: DENY on the PDF.
    expect(subframeLoadFailureFromEvent(-27, pdfUrl, false)).toEqual({
      url: pdfUrl,
      errorCode: -27,
    });
  });

  it('ignores the main document and frames that were navigated away', () => {
    expect(subframeLoadFailureFromEvent(-27, pdfUrl, true)).toBeNull();
    expect(subframeLoadFailureFromEvent(-3, pdfUrl, false)).toBeNull();
    expect(subframeLoadFailureFromEvent(-27, '', false)).toBeNull();
  });

  it('accepts only well-formed payloads from IPC', () => {
    expect(isSubframeLoadFailure({ url: pdfUrl, errorCode: -27 })).toBe(true);
    expect(isSubframeLoadFailure({ url: pdfUrl })).toBe(false);
    expect(isSubframeLoadFailure({ url: 1, errorCode: -27 })).toBe(false);
    expect(isSubframeLoadFailure(null)).toBe(false);
  });

  it('matches the reported URL with the iframe src after normalization', () => {
    expect(isSameFrameUrl(pdfUrl, pdfUrl)).toBe(true);
    expect(
      isSameFrameUrl(
        'http://LOCALHOST:5001/files/stream?path=a%20b.pdf',
        'http://localhost:5001/files/stream?path=a b.pdf'
      )
    ).toBe(true);
    const localUrl = 'localfile://preview/?path=%2Fworkspace%2Freport.pdf';
    expect(isSameFrameUrl(localUrl, localUrl)).toBe(true);
    expect(
      isSameFrameUrl(pdfUrl, pdfUrl.replace('report.pdf', 'other.pdf'))
    ).toBe(false);
  });

  it('is sent by the main window when an embedded frame fails', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );
    const start = source.indexOf("'did-fail-load',");
    const handler = source.slice(start, source.indexOf('\n  );\n', start));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('subframeLoadFailureFromEvent(');
    expect(handler).toMatch(
      /webContents\.send\(\s*SUBFRAME_LOAD_FAILED_CHANNEL,\s*subframeFailure/
    );
    expect(SUBFRAME_LOAD_FAILED_CHANNEL).toBe('subframe-load-failed');
  });
});
