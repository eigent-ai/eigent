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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The `frame-src` sources of the app window's Content Security Policy. */
function frameSources(): string[] {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const policy = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/
  )?.[1];
  const directive = policy
    ?.split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === 'frame-src');
  if (!directive) throw new Error('index.html has no frame-src directive');
  return directive.slice(1);
}

describe('app window frame policy', () => {
  it('frames previews served on any local port', () => {
    expect(frameSources()).toEqual(
      expect.arrayContaining([
        'http://localhost:*',
        'http://127.0.0.1:*',
        'https://localhost:*',
        'https://127.0.0.1:*',
      ])
    );
  });

  it('does not frame pages from other hosts', () => {
    // Every source must be one of these. A bare host such as `example.com`
    // would allow that host, so nothing outside the list is accepted.
    for (const source of frameSources()) {
      expect(source).toMatch(
        /^('self'|localfile:|blob:|data:|https?:\/\/(localhost|127\.0\.0\.1):(\*|\d+))$/
      );
    }
  });
});
