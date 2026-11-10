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
  clearRenderedMarkdownCache,
  readRenderedMarkdown,
  renderedMarkdownCacheChars,
  saveRenderedMarkdown,
} from '@/components/ChatBox/MessageItem/renderedMarkdownCache';
import { beforeEach, describe, expect, it } from 'vitest';

const MAX_ENTRY = 100_000;
const MAX_TOTAL = 4_000_000;
const chunk = 'x'.repeat(MAX_ENTRY / 2);

describe('renderedMarkdownCache', () => {
  beforeEach(() => clearRenderedMarkdownCache());

  it('returns what it saved', () => {
    saveRenderedMarkdown('key', '<p>hello</p>');
    expect(readRenderedMarkdown('key')).toBe('<p>hello</p>');
  });

  it('counts the rendered HTML too, so one huge message is not kept', () => {
    saveRenderedMarkdown('key', 'x'.repeat(MAX_ENTRY));
    expect(readRenderedMarkdown('key')).toBeUndefined();
    expect(renderedMarkdownCacheChars()).toBe(0);
  });

  it('drops the least recently read once the total is too large', () => {
    const count = Math.ceil(MAX_TOTAL / chunk.length) + 2;
    saveRenderedMarkdown('first', chunk);
    saveRenderedMarkdown('second', chunk);
    expect(readRenderedMarkdown('first')).toBe(chunk);
    for (let index = 0; index < count; index += 1) {
      saveRenderedMarkdown(`key-${index}`, chunk);
      if (index < count - 1) readRenderedMarkdown('first');
    }

    expect(renderedMarkdownCacheChars()).toBeLessThanOrEqual(MAX_TOTAL);
    expect(readRenderedMarkdown('second')).toBeUndefined();
    expect(readRenderedMarkdown('first')).toBe(chunk);
  });

  it('does not count a message saved again twice', () => {
    saveRenderedMarkdown('key', chunk);
    const once = renderedMarkdownCacheChars();
    saveRenderedMarkdown('key', chunk);
    expect(renderedMarkdownCacheChars()).toBe(once);
  });
});
