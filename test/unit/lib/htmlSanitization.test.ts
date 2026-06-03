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

import { isStaticImageSrc, stripScriptBlocks } from '@/lib/htmlSanitization';

describe('isStaticImageSrc', () => {
  it('accepts static relative paths', () => {
    expect(isStaticImageSrc('assets/home.png')).toBe(true);
  });

  it('rejects JS template literal expressions', () => {
    expect(isStaticImageSrc('${escapeHtml(node.image)}')).toBe(false);
    expect(isStaticImageSrc('assets/${node.id}.png')).toBe(false);
  });
});

describe('stripScriptBlocks', () => {
  it('removes script blocks so img scans skip JS template strings', () => {
    const html = `
      <img src="assets/home.png" alt="home">
      <script>
        const row = \`<img src="\${escapeHtml(node.image)}" alt="node">\`;
      </script>
    `;

    expect(stripScriptBlocks(html)).not.toContain('escapeHtml');
    expect(stripScriptBlocks(html)).toContain('assets/home.png');
  });
});
