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

import { formatHubDate } from '@/components/Home/utils';
import { describe, expect, it } from 'vitest';

describe('Space detail date formatting', () => {
  const createdAt = '2026-09-11T12:00:00.000Z';

  it('formats the Created value with the selected app language', () => {
    expect(formatHubDate(createdAt, 'en-US')).toBe('Sep 11, 2026');
    expect(formatHubDate(createdAt, 'zh-Hans')).toBe('2026年9月11日');
  });

  it.each([null, undefined, '', 'not-a-date'])(
    'returns an empty value for %s',
    (value) => {
      expect(formatHubDate(value, 'en-US')).toBe('');
    }
  );
});
