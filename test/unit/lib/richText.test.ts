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

import { rememberConnectorChipIcon } from '@/lib/connectorChipIcon';
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

describe('connector tags', () => {
  const render = (text: string) => {
    const root = document.createElement('div');
    root.innerHTML = segmentsToHtml(tokenizeRichPlainText(text));
    return root;
  };

  it('shows the logo and name instead of the @ prefix', () => {
    const tag = render('post to @Slack').querySelector<HTMLElement>(
      '[data-rich-connector]'
    )!;
    const logo = tag.querySelector('img')!;

    expect(logo.getAttribute('alt')).toBe('');
    expect(logo.getAttribute('src')).toBeTruthy();
    expect(tag.querySelector('.sr-only')?.textContent).toBe('@');
    // The @ stays in the text so the prompt value and caret offsets match.
    expect(tag.textContent).toBe('@Slack');
  });

  it('remembers a hosted connector logo reported by the API', () => {
    rememberConnectorChipIcon('@Linear', 'https://cdn.example/linear.svg');
    expect(render('@Linear').querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example/linear.svg'
    );
  });
});
