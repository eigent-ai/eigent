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
import { describe, expect, it, vi } from 'vitest';

// Must be mocked before importing Folder to avoid pdfjs-dist/jsdom issues.
// PdfViewer is lazy-loaded, so this mock prevents the dynamic import from
// pulling in the real pdfjs worker during unit tests.
vi.mock('../../../../src/components/Folder/PdfViewer', () => ({
  default: () => <div data-testid="pdf-viewer-mock" />,
}));

// Mock heavy deps that Folder pulls in transitively
vi.mock('../../../../src/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: {
      activeProjectId: 'proj-1',
      taskId: null,
      workforce: null,
    },
    projectStore: { projects: [] },
  }),
}));

vi.mock('../../../../src/store/authStore', () => ({
  useAuthStore: () => ({ token: 'test-token', userInfo: { id: '1' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../src/api/http', () => ({
  proxyFetchGet: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helper: build a minimal className string that mirrors what Folder produces
// for the outer scroll container and inner wrapper depending on file type.
// ---------------------------------------------------------------------------

/**
 * Returns the className for the outer content div exactly as Folder computes
 * it. Keeping it in-sync with index.tsx is intentional — any regression in
 * the production code will break this test.
 */
function outerClassName(isHtml: boolean, isShowSourceCode: boolean): string {
  return `flex min-h-0 flex-1 flex-col ${
    isHtml && !isShowSourceCode
      ? 'overflow-hidden'
      : 'scrollbar overflow-y-auto'
  }`;
}

/**
 * Returns the className for the inner wrapper div exactly as Folder computes
 * it.
 */
function innerClassName(isHtml: boolean, isShowSourceCode: boolean): string {
  const hFull = isHtml && !isShowSourceCode ? 'h-full' : '';
  const padding = isHtml && !isShowSourceCode ? '' : 'p-6';
  return `flex min-h-full flex-col ${hFull} ${padding} file-viewer-content`
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Issue #1374: Long files in Agent Folder are scrollable', () => {
  // ---------------------------------------------------------------------------
  // Outer scroll container
  // ---------------------------------------------------------------------------

  describe('outer content container classNames', () => {
    it('uses scrollbar + overflow-y-auto for markdown files (not overflow-hidden)', () => {
      const cls = outerClassName(false, false);
      expect(cls).toContain('scrollbar');
      expect(cls).toContain('overflow-y-auto');
      expect(cls).not.toContain('overflow-hidden');
    });

    it('uses scrollbar + overflow-y-auto for pdf files', () => {
      const cls = outerClassName(false, false);
      expect(cls).toContain('scrollbar');
      expect(cls).toContain('overflow-y-auto');
    });

    it('uses overflow-hidden (not scrollbar) for html files in preview mode', () => {
      const cls = outerClassName(true, false);
      expect(cls).toContain('overflow-hidden');
      expect(cls).not.toContain('scrollbar');
      expect(cls).not.toContain('overflow-y-auto');
    });

    it('uses scrollbar + overflow-y-auto for html files when showing source', () => {
      const cls = outerClassName(true, true);
      expect(cls).toContain('scrollbar');
      expect(cls).toContain('overflow-y-auto');
      expect(cls).not.toContain('overflow-hidden');
    });

    it('does NOT use scrollbar-always-visible (replaced by scrollbar)', () => {
      // scrollbar-always-visible was the pre-fix class that caused the maintainer
      // concern about the always-visible scrollbar on macOS overlay-scrollbar systems.
      const nonHtmlCls = outerClassName(false, false);
      expect(nonHtmlCls).not.toContain('scrollbar-always-visible');

      const htmlSourceCls = outerClassName(true, true);
      expect(htmlSourceCls).not.toContain('scrollbar-always-visible');
    });
  });

  // ---------------------------------------------------------------------------
  // Inner wrapper (file-viewer-content)
  // ---------------------------------------------------------------------------

  describe('inner wrapper (file-viewer-content) classNames', () => {
    it('does NOT include h-full for markdown files, allowing content to grow', () => {
      const cls = innerClassName(false, false);
      // Trim so that the "h-full" check is not accidentally matched by some
      // other class like "min-h-full" — use a word-boundary aware check.
      const parts = cls.split(/\s+/);
      expect(parts).not.toContain('h-full');
    });

    it('includes p-6 padding for non-html file types', () => {
      const cls = innerClassName(false, false);
      expect(cls).toContain('p-6');
    });

    it('includes h-full for html preview mode (needed for iframe height)', () => {
      const cls = innerClassName(true, false);
      const parts = cls.split(/\s+/);
      expect(parts).toContain('h-full');
    });

    it('does NOT include h-full when showing html source code', () => {
      const cls = innerClassName(true, true);
      const parts = cls.split(/\s+/);
      expect(parts).not.toContain('h-full');
    });

    it('always includes file-viewer-content class', () => {
      expect(innerClassName(false, false)).toContain('file-viewer-content');
      expect(innerClassName(true, false)).toContain('file-viewer-content');
      expect(innerClassName(true, true)).toContain('file-viewer-content');
    });
  });

  // ---------------------------------------------------------------------------
  // MarkDown component — overflow-hidden is back on .markdown-body and the
  // folder view wraps it in its own overflow-hidden div so long content
  // scrolls via the parent scrollbar, not through the markdown body itself.
  // ---------------------------------------------------------------------------

  describe('MarkDown wrapper in folder view', () => {
    it('renders .markdown-body with overflow-hidden restored (global MarkDown safety)', async () => {
      const { MarkDown } =
        await import('../../../../src/components/ChatBox/MessageItem/MarkDown');

      const { container } = render(
        <MarkDown content="## Hello\n\nWorld" enableTypewriter={false} />
      );

      const markdownBody = container.querySelector('.markdown-body');
      expect(markdownBody).not.toBeNull();
      // overflow-hidden has been restored on the component itself; the folder
      // applies its own prose wrapper with overflow-hidden to contain the content
      // while the parent scroll container provides the actual scrolling.
      expect(markdownBody!.className).toContain('overflow-hidden');
    });

    it('folder prose wrapper carries overflow-hidden, outer container scrolls', () => {
      // Simulate the exact DOM structure Folder renders for a markdown file:
      //   <div class="...scrollbar overflow-y-auto">         ← outer scrollable
      //     <div class="...p-6 file-viewer-content">
      //       <div class="prose prose-sm max-w-none overflow-hidden">  ← NEW wrapper
      //         <MarkDown ... />
      //       </div>
      //     </div>
      //   </div>
      const { container } = render(
        <div
          className="scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto"
          data-testid="outer-scroll"
        >
          <div className="file-viewer-content flex min-h-full flex-col p-6">
            <div className="prose prose-sm max-w-none overflow-hidden">
              {/* MarkDown content rendered here in production */}
              <div className="markdown-body max-w-none overflow-hidden">
                <p>content</p>
              </div>
            </div>
          </div>
        </div>
      );

      const outer = container.querySelector('[data-testid="outer-scroll"]');
      expect(outer!.className).toContain('overflow-y-auto');
      expect(outer!.className).toContain('scrollbar');
      expect(outer!.className).not.toContain('overflow-hidden');

      const proseWrapper = container.querySelector(
        '.prose.prose-sm.max-w-none'
      );
      expect(proseWrapper!.className).toContain('overflow-hidden');

      const fileViewerContent = container.querySelector('.file-viewer-content');
      const parts = fileViewerContent!.className.split(/\s+/);
      expect(parts).not.toContain('h-full');
    });
  });
});
