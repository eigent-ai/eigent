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

import { segmentsToHtml, tokenizeRichPlainText } from '@/lib/richText';

describe('rich chat tag typography', () => {
  it.each(['@github', '#browser'])(
    'keeps %s aligned to the surrounding body text',
    (token) => {
      const html = segmentsToHtml(tokenizeRichPlainText(token));

      expect(html).toContain('<span');
      expect(html).toContain('align-baseline');
      expect(html).toContain('!text-ds-text-base');
      expect(html).toContain('!font-normal');
      expect(html).not.toContain('py-px');
    }
  );
});
