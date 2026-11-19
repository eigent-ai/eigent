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

import { describe, expect, it } from 'vitest';
import { filePathFromLocalFileUrl } from '../../../electron/main/localFileUrl';

describe('filePathFromLocalFileUrl', () => {
  it('preserves case and spaces for the fixed-host URL format', () => {
    expect(
      filePathFromLocalFileUrl(
        'localfile://preview/?path=%2FUsers%2FExample%20User%2FReport.pdf'
      )
    ).toBe('/Users/Example User/Report.pdf');
  });

  it('preserves a navigable fixed-host pathname after relative resolution', () => {
    const linkedUrl = new URL(
      '../%E7%AC%AC7%E8%AF%BE%E6%97%B6/index.html',
      'localfile://preview/Users/Example%20User/project/%E7%AC%AC%E4%B8%80%E8%AF%BE%E6%97%B6/'
    );

    expect(filePathFromLocalFileUrl(linkedUrl.toString())).toBe(
      '/Users/Example User/project/第7课时/index.html'
    );
  });

  it('reconstructs legacy macOS URLs whose first segment became a host', () => {
    expect(
      filePathFromLocalFileUrl('localfile://users/4pmtong/report.pdf')
    ).toBe('/users/4pmtong/report.pdf');
  });
});
