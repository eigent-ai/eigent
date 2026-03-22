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

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { isHtmlDocument } from '@/lib/htmlFontStyles';
import '@/style/markdown-styles.css';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { memo, useEffect, useRef, useState } from 'react';

// Helper functions for path resolution
function joinPath(...paths: string[]): string {
  return paths
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

function resolveRelativePath(basePath: string, relativePath: string): string {
  const normalizedBase = basePath.replace(/\\/g, '/');
  const normalizedRelative = relativePath.replace(/\\/g, '/');
  if (
    !normalizedRelative.startsWith('./') &&
    !normalizedRelative.startsWith('../')
  ) {
    return joinPath(normalizedBase, normalizedRelative);
  }
  const baseParts = normalizedBase.split('/').filter(Boolean);
  const relativeParts = normalizedRelative.split('/').filter(Boolean);
  for (const part of relativeParts) {
    if (part === '.') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join('/');
}

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

export const MarkDown = memo(
  ({
    content,
    speed = 10,
    onTyping,
    enableTypewriter = true,
    contentBasePath,
  }: {
    content: string;
    speed?: number;
    onTyping?: () => void;
    enableTypewriter?: boolean;
    pTextSize?: string;
    olPadding?: string;
    /** Base directory for resolving relative image paths (e.g. markdown file's directory). */
    contentBasePath?: string | null;
  }) => {
    const [displayedContent, setDisplayedContent] = useState('');
    const [html, setHtml] = useState('');
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastContentRef = useRef<string | null>(null);
    const typingCallbackRef = useRef(onTyping);

    useEffect(() => {
      typingCallbackRef.current = onTyping;
    }, [onTyping]);

    // Typewriter effect
    useEffect(() => {
      if (lastContentRef.current === content) {
        return;
      }
      lastContentRef.current = content;

      if (!enableTypewriter) {
        setDisplayedContent(content);
        if (typingCallbackRef.current) {
          typingCallbackRef.current();
        }
        return;
      }

      setDisplayedContent('');
      let index = 0;

      const timer = setInterval(() => {
        if (index < content.length) {
          setDisplayedContent(content.slice(0, index + 1));
          index++;
        } else {
          clearInterval(timer);
          if (typingCallbackRef.current) {
            typingCallbackRef.current();
          }
        }
      }, speed);

      return () => clearInterval(timer);
    }, [content, speed, enableTypewriter]);

    // Convert markdown to HTML and process images
    useEffect(() => {
      const processMarkdown = async () => {
        if (!displayedContent) {
          setHtml('');
          return;
        }

        // If content is pure HTML, handle it separately
        if (isHtmlDocument(displayedContent)) {
          const formattedHtml = displayedContent
            .split('\n')
            .map((line) => line.trimStart())
            .join('\n')
            .trim();
          setHtml(
            `<pre class="bg-code-surface p-2 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all" style="word-break: break-all;"><code>${DOMPurify.sanitize(formattedHtml)}</code></pre>`
          );
          return;
        }

        // Parse markdown to HTML
        let rawHtml = await marked.parse(displayedContent);

        // Process images: replace relative paths with data URLs
        if (contentBasePath) {
          const imgRegex = /<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi;
          const matches = Array.from(rawHtml.matchAll(imgRegex));

          for (const match of matches) {
            const fullTag = match[0];
            const beforeSrc = match[1];
            const src = match[2];
            const afterSrc = match[3];

            // Check if it's a relative path
            const isRelative =
              src &&
              !src.startsWith('http://') &&
              !src.startsWith('https://') &&
              !src.startsWith('data:');

            if (isRelative && contentBasePath) {
              try {
                const resolvedPath = resolveRelativePath(contentBasePath, src);

                if (
                  typeof window !== 'undefined' &&
                  window.electronAPI?.readFileAsDataUrl
                ) {
                  const dataUrl =
                    await window.electronAPI.readFileAsDataUrl(resolvedPath);

                  // Add cursor-pointer class and data attributes for click handling
                  const newTag = `<img${beforeSrc}src="${dataUrl}"${afterSrc} class="cursor-pointer hover:opacity-90 transition-opacity" data-clickable="true" style="max-height: 320px; object-fit: contain;">`;
                  rawHtml = rawHtml.replace(fullTag, newTag);
                } else {
                  // Fallback: show alt text or placeholder
                  const altMatch = fullTag.match(/alt=["']([^"']*)["']/);
                  const alt = altMatch ? altMatch[1] : 'image';
                  const placeholder = `<span class="inline-block text-sm text-text-secondary">[${alt}]</span>`;
                  rawHtml = rawHtml.replace(fullTag, placeholder);
                }
              } catch (error) {
                console.error(`Failed to load image: ${src}`, error);
                // Keep original tag if loading fails
              }
            } else {
              // For absolute URLs, add click handler
              const newTag = fullTag.replace(
                '<img',
                '<img class="cursor-pointer hover:opacity-90 transition-opacity" data-clickable="true" style="max-height: 320px; object-fit: contain;"'
              );
              rawHtml = rawHtml.replace(fullTag, newTag);
            }
          }
        }

        // Sanitize HTML
        const sanitized = DOMPurify.sanitize(rawHtml);
        setHtml(sanitized);
      };

      processMarkdown();
    }, [displayedContent, contentBasePath]);

    // Add click handlers for images
    useEffect(() => {
      if (!contentRef.current) return;

      const handleImageClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'IMG' &&
          target.getAttribute('data-clickable') === 'true'
        ) {
          const src = (target as HTMLImageElement).src;
          setPreviewImage(src);
        }
      };

      const div = contentRef.current;
      div.addEventListener('click', handleImageClick);

      return () => {
        div.removeEventListener('click', handleImageClick);
      };
    }, [html]);

    return (
      <>
        <div
          ref={contentRef}
          className="markdown-body max-w-none overflow-hidden"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Image preview dialog */}
        <Dialog
          open={!!previewImage}
          onOpenChange={() => setPreviewImage(null)}
        >
          <DialogContent
            size="lg"
            className="flex h-auto max-h-[95vh] w-auto max-w-[95vw] items-center justify-center p-2"
            showCloseButton
          >
            {previewImage && (
              <img
                src={previewImage}
                alt="Preview"
                className="h-auto max-h-[90vh] w-auto max-w-full rounded object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

MarkDown.displayName = 'MarkDown';
