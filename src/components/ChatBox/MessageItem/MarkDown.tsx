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
import { useHost } from '@/host';
import { fileInfoFromPath } from '@/lib/fileInfo';
import { isHtmlDocument } from '@/lib/htmlFontStyles';
import { escapeHtml } from '@/lib/richText';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import '@/style/markdown-styles.css';
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

export type MarkdownProfile = 'conversation' | 'compact' | 'document';

const COLLAPSE_AFTER_LINES: Record<MarkdownProfile, number> = {
  conversation: 20,
  compact: 12,
  document: 32,
};

const COPYABLE_TEXT_MIN_LENGTH = 120;
const WRAPPED_CODE_LANGUAGES = new Set([
  'text',
  'plaintext',
  'txt',
  'markdown',
  'md',
]);

function getDocumentAppearance(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function useDocumentAppearance(): 'light' | 'dark' {
  const [appearance, setAppearance] = useState(getDocumentAppearance);

  useEffect(() => {
    const root = document.documentElement;
    const updateAppearance = () => setAppearance(getDocumentAppearance());
    const observer = new MutationObserver(updateAppearance);

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    updateAppearance();

    return () => observer.disconnect();
  }, []);

  return appearance;
}

function copyButtonContents(label: string, copied = false): string {
  const safeLabel = escapeHtml(label);
  const icon = copied
    ? '<path d="M20 6 9 17l-5-5" />'
    : '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />';

  return `<svg class="markdown-copy-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span class="markdown-copy-label">${safeLabel}</span>`;
}

function normalizedCodeLanguage(lang?: string): string {
  return (lang ?? '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9_+#.-]/g, '');
}

function codeBlockHtml(
  text: string,
  lang: string | undefined,
  profile: MarkdownProfile,
  labels: { code: string; copy: string; expand: string }
): string {
  const language = normalizedCodeLanguage(lang);
  const lines = text ? text.replace(/\n$/, '').split('\n').length : 0;
  const collapsible = lines > COLLAPSE_AFTER_LINES[profile];
  const languageLabel = language || labels.code;
  const wrapsLongLines = WRAPPED_CODE_LANGUAGES.has(language);
  return `<div class="markdown-code-block" data-expanded="false"${
    collapsible ? ' data-collapsible="true"' : ''
  }${
    wrapsLongLines ? ' data-wrap-lines="true"' : ''
  }><div class="markdown-code-toolbar"><span class="markdown-code-language">${escapeHtml(
    languageLabel
  )}</span><button type="button" class="markdown-copy-button markdown-code-action" data-markdown-code-copy aria-label="${escapeHtml(
    labels.copy
  )}" title="${escapeHtml(labels.copy)}">${copyButtonContents(
    labels.copy
  )}</button></div><pre tabindex="0"><code${
    language
      ? ` class="language-${language}" data-markdown-language="${language}"`
      : ''
  }>${escapeHtml(text)}</code></pre>${
    collapsible
      ? `<button type="button" class="markdown-code-expand" data-markdown-code-expand>${escapeHtml(
          labels.expand
        )}</button>`
      : ''
  }</div>`;
}

function createMarkdownParser(
  profile: MarkdownProfile,
  labels: { code: string; copy: string; expand: string }
) {
  const parser = new Marked({ gfm: true, breaks: true, async: false });
  parser.use({
    renderer: {
      code(token: Tokens.Code) {
        return codeBlockHtml(token.text, token.lang, profile, labels);
      },
    },
  });
  return parser;
}

export const MarkDown = memo(
  ({
    content,
    speed = 10,
    onTyping,
    onMarkdownRenderComplete,
    enableTypewriter = true,
    contentBasePath,
    profile = 'conversation',
    className,
  }: {
    content: string;
    speed?: number;
    onTyping?: () => void;
    /** Fires once per stable `content` when full text is shown and markdown HTML has been applied (after typewriter catches up if enabled). */
    onMarkdownRenderComplete?: () => void;
    enableTypewriter?: boolean;
    pTextSize?: string;
    olPadding?: string;
    /** Base directory for resolving relative image paths (e.g. markdown file's directory). */
    contentBasePath?: string | null;
    /** Typography density for chat, tool-detail, and standalone document use. */
    profile?: MarkdownProfile;
    className?: string;
  }) => {
    const { t } = useTranslation();
    const host = useHost();
    const electronAPI = host?.electronAPI;
    const appearance = useDocumentAppearance();
    const openFilePreview = usePageTabStore((s) => s.openFilePreview);
    const openBrowserPreview = usePageTabStore((s) => s.openBrowserPreview);
    const [displayedContent, setDisplayedContent] = useState('');
    const [html, setHtml] = useState('');
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const rawCodeByElementRef = useRef(new WeakMap<Element, string>());
    const rawTextByElementRef = useRef(new WeakMap<Element, string>());
    const lastContentRef = useRef<string | null>(null);
    /** Tracks how many characters have been typed so far — lets streaming
     *  appends continue from the current position instead of restarting. */
    const typingIndexRef = useRef(0);
    const typingCallbackRef = useRef(onTyping);
    const renderCompleteRef = useRef(onMarkdownRenderComplete);

    useEffect(() => {
      typingCallbackRef.current = onTyping;
    }, [onTyping]);

    useEffect(() => {
      renderCompleteRef.current = onMarkdownRenderComplete;
    }, [onMarkdownRenderComplete]);

    // Typewriter effect
    useEffect(() => {
      if (!enableTypewriter) {
        lastContentRef.current = content;
        typingIndexRef.current = content.length;
        setDisplayedContent(content);
        if (typingCallbackRef.current) {
          typingCallbackRef.current();
        }
        return;
      }

      if (lastContentRef.current === content) {
        return;
      }

      const prevContent = lastContentRef.current ?? '';
      lastContentRef.current = content;

      // When content is a streaming append of the previous value, continue
      // typing from the current position instead of restarting from zero.
      // This prevents the displayed text from blanking out on every SSE chunk.
      const isAppend = content.startsWith(prevContent);
      if (!isAppend) {
        setDisplayedContent('');
        typingIndexRef.current = 0;
      }
      let index = isAppend ? typingIndexRef.current : 0;

      const timer = setInterval(() => {
        if (index < content.length) {
          setDisplayedContent(content.slice(0, index + 1));
          index++;
          typingIndexRef.current = index;
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
      let cancelled = false;
      const processMarkdown = async () => {
        if (!displayedContent) {
          if (!cancelled) setHtml('');
          return;
        }

        const labels = {
          code: t('markdown.code', { defaultValue: 'Code' }),
          copy: t('markdown.copy-code', { defaultValue: 'Copy' }),
          expand: t('markdown.show-more-code', { defaultValue: 'Show more' }),
        };

        // If content is pure HTML, handle it separately
        if (isHtmlDocument(displayedContent)) {
          const formattedHtml = displayedContent
            .split('\n')
            .map((line) => line.trimStart())
            .join('\n')
            .trim();
          if (cancelled) return;
          setHtml(codeBlockHtml(formattedHtml, 'html', profile, labels));
          if (displayedContent === content && renderCompleteRef.current) {
            renderCompleteRef.current();
          }
          return;
        }

        // Parse markdown to HTML
        const parser = createMarkdownParser(profile, labels);
        // This parser has no async extensions. Keep the initial render in the
        // current effect tick so existing timeline and tool-detail surfaces do
        // not flash empty while waiting for an unnecessary microtask.
        let rawHtml = parser.parse(displayedContent) as string;
        if (cancelled) return;

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
              !src.includes('${') &&
              !src.startsWith('http://') &&
              !src.startsWith('https://') &&
              !src.startsWith('data:');

            if (isRelative && contentBasePath) {
              try {
                const resolvedPath = resolveRelativePath(contentBasePath, src);

                if (electronAPI?.readFileAsDataUrl) {
                  const dataUrl =
                    await electronAPI.readFileAsDataUrl(resolvedPath);
                  if (cancelled) return;

                  // Add cursor-pointer class and data attributes for click handling
                  const newTag = `<img${beforeSrc}src="${dataUrl}"${afterSrc} class="cursor-pointer hover:opacity-90 transition-opacity" data-clickable="true" style="max-height: 320px; object-fit: contain;">`;
                  rawHtml = rawHtml.replace(fullTag, newTag);
                } else {
                  // Fallback: show alt text or placeholder
                  const altMatch = fullTag.match(/alt=["']([^"']*)["']/);
                  const alt = altMatch ? altMatch[1] : 'image';
                  const placeholder = `<span class="inline-block text-sm text-ds-ink-muted-default">[${alt}]</span>`;
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

        // Annotate links that point to local project files so clicking them
        // opens the inline file preview instead of navigating the renderer.
        // External links (http/mailto/anchors/etc.) are left untouched.
        const anchorRegex = /<a([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi;
        for (const match of Array.from(rawHtml.matchAll(anchorRegex))) {
          const fullTag = match[0];
          const href = match[2];
          if (!href) continue;
          const lower = href.trim().toLowerCase();
          const isExternalOrSpecial =
            lower.startsWith('http://') ||
            lower.startsWith('https://') ||
            lower.startsWith('mailto:') ||
            lower.startsWith('tel:') ||
            lower.startsWith('data:') ||
            lower.startsWith('vbscript:') ||
            lower.startsWith('javascript:') ||
            href.startsWith('#') ||
            href.includes('${');
          if (isExternalOrSpecial) continue;

          let resolved = href;
          if (href.startsWith('file://')) {
            resolved = decodeURIComponent(href.replace(/^file:\/\//, ''));
          } else {
            const isRelative =
              !href.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(href);
            if (isRelative && contentBasePath) {
              resolved = resolveRelativePath(contentBasePath, href);
            }
          }

          const newTag = fullTag.replace(
            /^<a/,
            `<a data-file-path="${resolved.replace(/"/g, '&quot;')}"`
          );
          rawHtml = rawHtml.replace(fullTag, newTag);
        }

        // Sanitize HTML — explicitly allow class so syntax-highlighted code
        // blocks keep their language-* className after sanitization.
        const sanitized = DOMPurify.sanitize(rawHtml, {
          ADD_ATTR: [
            'class',
            'data-clickable',
            'data-file-path',
            'data-markdown-code-copy',
            'data-markdown-code-expand',
            'data-markdown-text-copy',
            'data-markdown-language',
            'data-collapsible',
            'data-expanded',
            'data-wrap-lines',
          ],
        });
        if (cancelled) return;
        setHtml(sanitized);
        if (displayedContent === content && renderCompleteRef.current) {
          renderCompleteRef.current();
        }
      };

      void processMarkdown();
      return () => {
        cancelled = true;
      };
    }, [displayedContent, content, contentBasePath, electronAPI, profile, t]);

    // Reuse the Monaco grammars already shipped for Source/Review. Highlight
    // only stable content so streaming responses stay cheap and responsive.
    useEffect(() => {
      const root = contentRef.current;
      if (!root || displayedContent !== content) return;
      const codeBlocks = Array.from(
        root.querySelectorAll<HTMLElement>('code[data-markdown-language]')
      );
      if (codeBlocks.length === 0) return;
      let cancelled = false;

      const colorize = async () => {
        const { highlightMarkdownCode } =
          await import('@/lib/markdownSyntaxHighlight');
        if (cancelled) return;
        await Promise.all(
          codeBlocks.map(async (code) => {
            const raw =
              rawCodeByElementRef.current.get(code) ?? code.textContent ?? '';
            rawCodeByElementRef.current.set(code, raw);
            const requested = code.dataset.markdownLanguage ?? '';
            const highlighted = await highlightMarkdownCode(
              raw,
              requested,
              appearance
            );
            if (!cancelled && highlighted && code.isConnected) {
              code.innerHTML = highlighted;
            }
          })
        );
      };

      void colorize();
      return () => {
        cancelled = true;
      };
    }, [appearance, content, displayedContent, html]);

    // Add a low-noise, hover-revealed copy affordance to long prose blocks.
    // Capture text before inserting the button so its accessible label never
    // leaks into the copied value.
    useEffect(() => {
      const root = contentRef.current;
      if (!root || displayedContent !== content) return;

      const copyLabel = t('markdown.copy-text', {
        defaultValue: 'Copy text',
      });
      const blocks = Array.from(
        root.querySelectorAll<HTMLElement>(':scope > p, :scope > blockquote')
      );

      blocks.forEach((block) => {
        if (block.querySelector(':scope > button[data-markdown-text-copy]')) {
          return;
        }
        const raw = (block.innerText || block.textContent || '').trim();
        if (raw.length < COPYABLE_TEXT_MIN_LENGTH) return;

        rawTextByElementRef.current.set(block, raw);
        block.classList.add('markdown-copyable-text');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'markdown-copy-button markdown-text-copy';
        button.dataset.markdownTextCopy = '';
        button.setAttribute('aria-label', copyLabel);
        button.title = copyLabel;
        button.innerHTML = copyButtonContents(copyLabel);
        block.append(button);
      });
    }, [content, displayedContent, html, t]);

    // Add click handlers for copy actions, images, and links.
    useEffect(() => {
      if (!contentRef.current) return;

      const copyWithFeedback = (
        raw: string,
        button: HTMLButtonElement,
        resetLabel: string
      ) => {
        if (!raw || !navigator.clipboard?.writeText) return;
        void navigator.clipboard
          .writeText(raw)
          .then(() => {
            const copiedLabel = t('markdown.copied', {
              defaultValue: 'Copied',
            });
            button.setAttribute('aria-label', copiedLabel);
            button.title = copiedLabel;
            button.innerHTML = copyButtonContents(copiedLabel, true);
            window.setTimeout(() => {
              if (button.isConnected) {
                button.setAttribute('aria-label', resetLabel);
                button.title = resetLabel;
                button.innerHTML = copyButtonContents(resetLabel);
              }
            }, 1500);
          })
          .catch(() => undefined);
      };

      const handleContentClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const copyButton = target.closest<HTMLButtonElement>(
          'button[data-markdown-code-copy]'
        );
        if (copyButton) {
          e.preventDefault();
          const code = copyButton
            .closest('.markdown-code-block')
            ?.querySelector('code');
          const raw = code
            ? (rawCodeByElementRef.current.get(code) ??
              (code as HTMLElement).innerText ??
              code.textContent ??
              '')
            : '';
          copyWithFeedback(
            raw,
            copyButton,
            t('markdown.copy-code', { defaultValue: 'Copy' })
          );
          return;
        }
        const textCopyButton = target.closest<HTMLButtonElement>(
          'button[data-markdown-text-copy]'
        );
        if (textCopyButton) {
          e.preventDefault();
          const block = textCopyButton.closest<HTMLElement>(
            '.markdown-copyable-text'
          );
          const raw = block
            ? (rawTextByElementRef.current.get(block) ?? '')
            : '';
          copyWithFeedback(
            raw,
            textCopyButton,
            t('markdown.copy-text', { defaultValue: 'Copy text' })
          );
          return;
        }
        const expandButton = target.closest<HTMLButtonElement>(
          'button[data-markdown-code-expand]'
        );
        if (expandButton) {
          e.preventDefault();
          const block = expandButton.closest<HTMLElement>(
            '.markdown-code-block'
          );
          if (!block) return;
          const expanded = block.dataset.expanded === 'true';
          block.dataset.expanded = String(!expanded);
          expandButton.textContent = expanded
            ? t('markdown.show-more-code', { defaultValue: 'Show more' })
            : t('markdown.show-less-code', { defaultValue: 'Show less' });
          return;
        }
        if (
          target.tagName === 'IMG' &&
          target.getAttribute('data-clickable') === 'true'
        ) {
          const src = (target as HTMLImageElement).src;
          setPreviewImage(src);
          return;
        }
        // Local file links open the inline preview instead of navigating.
        const anchor = target.closest('a[data-file-path]');
        if (anchor) {
          e.preventDefault();
          const filePath = anchor.getAttribute('data-file-path');
          if (filePath) {
            openFilePreview(fileInfoFromPath(filePath));
          }
          return;
        }
        // Web links stay inside the session: open them in the preview
        // browser of this project. (On the web host, where no embedded
        // browser exists, fall back to a regular browser tab.)
        const link = target.closest('a[href]');
        if (link) {
          const href = link.getAttribute('href') ?? '';
          if (/^https?:\/\//i.test(href)) {
            e.preventDefault();
            if (electronAPI) {
              openBrowserPreview(href);
            } else {
              window.open(href, '_blank', 'noopener,noreferrer');
            }
          }
        }
      };

      const div = contentRef.current;
      div.addEventListener('click', handleContentClick);

      return () => {
        div.removeEventListener('click', handleContentClick);
      };
    }, [html, openFilePreview, openBrowserPreview, electronAPI, t]);

    return (
      <>
        <div
          ref={contentRef}
          className={cn(
            'markdown-body max-w-none min-w-0 overflow-hidden',
            `markdown-profile-${profile}`,
            className
          )}
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
