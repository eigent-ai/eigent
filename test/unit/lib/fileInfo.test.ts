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

import { fileInfoFromPath } from '@/lib/fileInfo';
import { describe, expect, it } from 'vitest';

describe('fileInfoFromPath', () => {
  it('turns sandbox file links into local file paths', () => {
    expect(
      fileInfoFromPath('sandbox:/Users/test/project/simple_greeting.py')
    ).toEqual({
      name: 'simple_greeting.py',
      path: '/Users/test/project/simple_greeting.py',
      type: 'py',
      isRemote: false,
    });
  });

  it('preserves remote URLs', () => {
    expect(fileInfoFromPath('https://example.com/report.csv')).toMatchObject({
      path: 'https://example.com/report.csv',
      type: 'csv',
      isRemote: true,
    });
  });
});
