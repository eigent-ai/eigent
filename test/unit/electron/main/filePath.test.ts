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

import { normalizeLegacySandboxPath } from '../../../../electron/main/utils/filePath';

describe('normalizeLegacySandboxPath', () => {
  it('repairs x-prefixed POSIX paths on non-Windows platforms', () => {
    expect(
      normalizeLegacySandboxPath('x:/Users/test/report.csv', 'darwin')
    ).toBe('/Users/test/report.csv');
    expect(
      normalizeLegacySandboxPath('x:\\home\\test\\report.csv', 'linux')
    ).toBe('/home/test/report.csv');
  });

  it('preserves valid Windows drive paths on Windows', () => {
    expect(
      normalizeLegacySandboxPath('X:/Users/test/report.csv', 'win32')
    ).toBe('X:/Users/test/report.csv');
  });

  it('does not change other local paths or remote URLs', () => {
    expect(normalizeLegacySandboxPath('/Users/test/report.csv', 'darwin')).toBe(
      '/Users/test/report.csv'
    );
    expect(
      normalizeLegacySandboxPath('https://example.com/report.csv', 'darwin')
    ).toBe('https://example.com/report.csv');
  });
});
