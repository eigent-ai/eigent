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

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkDown } from '../../../../src/components/ChatBox/MessageItem/MarkDown';

// Generate a long markdown string that would exceed any reasonable viewport
const generateLongMarkdown = (paragraphs: number): string =>
  Array.from(
    { length: paragraphs },
    (_, i) =>
      `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with enough text to take up space. ` +
      `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ` +
      `ut labore et dolore magna aliqua.\n`
  ).join('\n');

describe('Issue #1374: Long files in Agent Folder are scrollable', () => {
  it('MarkDown component does not use overflow-hidden, allowing parent to scroll', () => {
    const longContent = generateLongMarkdown(50);

    const { container } = render(
      <div
        className="scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{ height: '400px' }}
        data-testid="folder-scroll-container"
      >
        <div className="file-viewer-content p-6">
          <div className="prose prose-sm max-w-none">
            <MarkDown content={longContent} enableTypewriter={false} />
          </div>
        </div>
      </div>
    );

    const markdownBody = container.querySelector('.markdown-body');
    expect(markdownBody).not.toBeNull();

    // overflow-hidden should NOT be present — it was removed so long content
    // can grow naturally and trigger the parent's overflow-y-auto scrollbar
    expect(markdownBody!.className).not.toContain('overflow-hidden');

    // The parent scroll container has overflow-y-auto
    const scrollContainer = container.querySelector(
      '[data-testid="folder-scroll-container"]'
    );
    expect(scrollContainer!.className).toContain('overflow-y-auto');
  });

  it('inner wrapper does not use h-full for markdown files, allowing content to grow', () => {
    const longContent = generateLongMarkdown(50);

    const { container } = render(
      // Matches the fixed Folder DOM hierarchy (no h-full for non-iframe types)
      <div
        className="scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{ height: '400px' }}
      >
        <div className="file-viewer-content p-6">
          <div className="prose prose-sm max-w-none">
            <MarkDown content={longContent} enableTypewriter={false} />
          </div>
        </div>
      </div>
    );

    // file-viewer-content should NOT have h-full for markdown files —
    // it was removed so the wrapper grows with content instead of being
    // capped to the parent's height
    const fileViewerContent = container.querySelector('.file-viewer-content');
    expect(fileViewerContent!.className).not.toContain('h-full');

    // markdown-body should not clip content
    const markdownBody = container.querySelector('.markdown-body');
    expect(markdownBody!.className).not.toContain('overflow-hidden');
  });
});
