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

import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Default rotating hints when the input is empty (30s per line). */
export const DEFAULT_CHAT_INPUT_PLACEHOLDERS = [
  'Automate market research, analysis, and reports',
  'Create slides, social posts, and brand content',
  'Organize files, documents, and desktop tasks',
] as const;

const PLACEHOLDER_ROTATE_MS = 30_000;

const DEFAULT_PLACEHOLDERS_ARR: string[] = [...DEFAULT_CHAT_INPUT_PLACEHOLDERS];

type RichSegment = { type: 'text' | 'url' | 'skill'; text: string };

const SKILL_STYLE_CLASSES = [
  'text-text-information bg-surface-information/35',
  'text-text-success bg-surface-success/25',
  'text-text-warning bg-surface-warning/35',
  'text-icon-information bg-surface-action/20',
] as const;

function hashSkillLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h << 5) - h + label.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Strip trailing punctuation often typed after pasted URLs. */
function trimUrlTail(raw: string): string {
  return raw.replace(/[`'".,;:!?)\]]+$/g, '');
}

const URL_AT_START = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i;

/** Plain-text tokenizer: http(s) / www URLs and #skill tokens (alphanumeric + _-). */
export function tokenizeRichPlainText(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const slice = text.slice(i);
    const urlMatch = slice.match(URL_AT_START);
    if (urlMatch) {
      const full = urlMatch[0];
      const trimmed = trimUrlTail(full);
      if (trimmed.length > 0) {
        out.push({ type: 'url', text: trimmed });
        if (full.length > trimmed.length) {
          out.push({ type: 'text', text: full.slice(trimmed.length) });
        }
        i += full.length;
        continue;
      }
    }

    if (slice[0] === '#') {
      const skillMatch = slice.match(/^#([a-zA-Z0-9_-]+)/);
      if (skillMatch) {
        out.push({ type: 'skill', text: skillMatch[0] });
        i += skillMatch[0].length;
        continue;
      }
    }

    let j = i + 1;
    while (j < len) {
      const tail = text.slice(j);
      if (URL_AT_START.test(tail)) break;
      if (text[j] === '#' && /^#([a-zA-Z0-9_-]+)/.test(tail)) break;
      j++;
    }
    out.push({ type: 'text', text: text.slice(i, j) });
    i = j;
  }

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function httpUrlOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^www\./i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return null;
  }
}

function segmentsToHtml(segments: RichSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      parts.push(escapeHtml(seg.text).replace(/\n/g, '<br />'));
    } else if (seg.type === 'url') {
      const href = httpUrlOrNull(seg.text);
      const safe = escapeHtml(seg.text);
      if (href) {
        parts.push(
          `<a href="${escapeHtml(href)}" data-rich-url="1" class="text-text-information underline decoration-text-information/80 underline-offset-2">${safe}</a>`
        );
      } else {
        parts.push(safe);
      }
    } else {
      const idx = hashSkillLabel(seg.text) % SKILL_STYLE_CLASSES.length;
      const cls = SKILL_STYLE_CLASSES[idx];
      parts.push(
        `<span data-rich-skill="1" class="rounded px-0.5 py-px font-medium ${cls}">${escapeHtml(seg.text)}</span>`
      );
    }
  }
  return parts.join('');
}

function brToNewlineInTree(container: HTMLElement): void {
  container.querySelectorAll('br').forEach((br) => {
    br.replaceWith(document.createTextNode('\n'));
  });
}

function innerPlainFromHtmlTree(container: HTMLElement): string {
  brToNewlineInTree(container);
  return container.innerText.replace(/\u00a0/g, ' ');
}

function getPlainTextFromRoot(root: HTMLElement): string {
  const html = root.innerHTML;
  if (!html || html === '<br>' || html === '<br/>' || html === '<br />') {
    return '';
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return innerPlainFromHtmlTree(tmp);
}

/**
 * Plain-text length from start of `root` to (container, offset), using the same
 * rules as getPlainTextFromRoot. Range#toString() is wrong for &lt;br&gt; and
 * block boundaries (e.g. Shift+Enter), which caused caret restore to jump.
 */
function plainTextLengthBefore(
  root: HTMLElement,
  endContainer: Node,
  endOffset: number
): number {
  if (!root.contains(endContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(endContainer, endOffset);
  const tmp = document.createElement('div');
  tmp.appendChild(pre.cloneContents());
  return innerPlainFromHtmlTree(tmp).length;
}

function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  return plainTextLengthBefore(root, range.startContainer, range.startOffset);
}

function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const walk = (
    node: Node,
    remaining: { n: number }
  ): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (remaining.n <= len) {
        return { node, offset: remaining.n };
      }
      remaining.n -= len;
      return null;
    }
    if (node.nodeName === 'BR') {
      if (remaining.n <= 0) {
        return { node, offset: 0 };
      }
      remaining.n -= 1;
      return null;
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      const found = walk(node.childNodes[i], remaining);
      if (found) return found;
    }
    return null;
  };

  const pos = walk(root, { n: offset });
  if (!pos) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  const range = document.createRange();
  if (pos.node.nodeType === Node.TEXT_NODE) {
    range.setStart(
      pos.node,
      Math.min(pos.offset, pos.node.textContent?.length ?? 0)
    );
    range.collapse(true);
  } else if (pos.node.nodeName === 'BR') {
    range.setStartBefore(pos.node);
    range.collapse(true);
  } else {
    range.selectNodeContents(pos.node);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Keep the caret visible when content is taller than max height (overflow scroll). */
function scrollCaretIntoView(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    return;
  }
  const range = sel.getRangeAt(0);
  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    if (last) rect = last;
  }
  if (rect.width === 0 && rect.height === 0) {
    root.scrollTop = root.scrollHeight - root.clientHeight;
    return;
  }

  const rootRect = root.getBoundingClientRect();
  const padding = 8;
  if (rect.bottom > rootRect.bottom - padding) {
    root.scrollTop += rect.bottom - rootRect.bottom + padding;
  } else if (rect.top < rootRect.top + padding) {
    root.scrollTop += rect.top - rootRect.top - padding;
  }
}

export interface RichChatInputProps {
  value: string;
  onChange: (value: string, cursorOffset?: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  disabled?: boolean;
  /** @deprecated Use `placeholders` for rotating copy. If set without `placeholders`, shown as a single static line when empty. */
  placeholder?: string;
  /** When empty, cycles through these every 30s. Defaults to product copy. */
  placeholders?: readonly string[];
  className?: string;
  textClassName?: string;
  style?: React.CSSProperties;
  maxHeightPx?: number;
}

export const RichChatInput = React.forwardRef<
  HTMLDivElement,
  RichChatInputProps
>(function RichChatInput(
  {
    value,
    onChange,
    onKeyDown,
    onFocus,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
    disabled,
    placeholder,
    placeholders: placeholdersProp,
    className,
    textClassName,
    style,
    maxHeightPx = 200,
  },
  ref
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const internalUpdate = useRef(false);
  const composingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref && 'current' in ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref]
  );

  const applyHtml = useCallback((plain: string, restoreOffset?: number) => {
    const el = rootRef.current;
    if (!el) return;
    if (plain.length === 0) {
      el.scrollTop = 0;
    }
    const html =
      plain.length === 0 ? '' : segmentsToHtml(tokenizeRichPlainText(plain));
    el.innerHTML = html || '<br />';
    if (restoreOffset !== undefined) {
      requestAnimationFrame(() => {
        setCaretOffset(el, Math.min(restoreOffset, plain.length));
        scrollCaretIntoView(el);
      });
    }
  }, []);

  const resizeHeight = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [maxHeightPx]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handleScroll = () => {
      el.classList.add('scrolling');
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        el.classList.remove('scrolling');
      }, 1000);
    };
    el.addEventListener('scroll', handleScroll);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (internalUpdate.current) {
      internalUpdate.current = false;
      resizeHeight();
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const current = getPlainTextFromRoot(el);
    if (current === value) {
      if (value === '' && el.innerHTML.replace(/\s/g, '') === '') {
        applyHtml('');
      }
      resizeHeight();
      return;
    }
    applyHtml(value);
    resizeHeight();
  }, [value, applyHtml, resizeHeight]);

  const handleInput = () => {
    const el = rootRef.current;
    if (!el || composingRef.current) return;
    const plain = getPlainTextFromRoot(el);
    const caret = getCaretOffset(el);
    internalUpdate.current = true;
    onChange(plain, caret);
    applyHtml(plain, caret);
    resizeHeight();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const el = rootRef.current;
    if (!el) return;
    document.execCommand('insertText', false, text);
  };

  const placeholders = useMemo(() => {
    if (placeholdersProp && placeholdersProp.length > 0) {
      return Array.from(placeholdersProp);
    }
    if (placeholder && placeholder.length > 0) {
      return [placeholder];
    }
    return DEFAULT_PLACEHOLDERS_ARR;
  }, [placeholdersProp, placeholder]);

  const showPlaceholder = value.length === 0 && placeholders.length > 0;
  const [placeholderCycleIndex, setPlaceholderCycleIndex] = useState(0);

  useEffect(() => {
    setPlaceholderCycleIndex(0);
  }, [placeholders]);

  useEffect(() => {
    if (!showPlaceholder || placeholders.length <= 1) return;
    const id = window.setInterval(() => {
      setPlaceholderCycleIndex((i) => (i + 1) % placeholders.length);
    }, PLACEHOLDER_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [showPlaceholder, placeholders.length]);

  const ariaPlaceholderLine = showPlaceholder
    ? placeholders[placeholderCycleIndex % placeholders.length]
    : undefined;

  return (
    <div className="min-w-0 relative isolate w-full flex-1">
      <div
        aria-hidden
        className="left-1 top-0 pointer-events-none absolute z-[1] w-[calc(100%-0.25rem)] max-w-[calc(100%-0.25rem)] select-none"
      >
        <AnimatePresence mode="wait">
          {showPlaceholder ? (
            <motion.span
              key={placeholders[placeholderCycleIndex % placeholders.length]}
              className="text-text-label block w-full font-[Inter] text-[13px] leading-[20px]"
              initial={{
                opacity: 0,
                filter: 'blur(8px)',
                y: -18,
              }}
              animate={{
                opacity: 1,
                filter: 'blur(0px)',
                y: 0,
              }}
              exit={{
                opacity: 0,
                filter: 'blur(8px)',
                y: 18,
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {placeholders[placeholderCycleIndex % placeholders.length]}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <div
        ref={setRootRef}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={ariaPlaceholderLine}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
          onCompositionStart?.();
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          onCompositionEnd?.();
          handleInput();
        }}
        className={cn(
          'w-full flex-1 resize-none overflow-auto outline-none',
          'pl-1 py-0 scrollbar max-h-[200px] min-h-[40px]',
          'relative break-words whitespace-pre-wrap',
          disabled && 'cursor-not-allowed opacity-60',
          textClassName,
          className
        )}
        style={style}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement | null;
          const a = t?.closest(
            'a[data-rich-url="1"]'
          ) as HTMLAnchorElement | null;
          if (a) {
            e.preventDefault();
            const href = a.getAttribute('href');
            const safe = href ? httpUrlOrNull(href) : null;
            if (safe) {
              window.open(safe, '_blank', 'noopener,noreferrer');
            }
          }
        }}
      />
    </div>
  );
});

RichChatInput.displayName = 'RichChatInput';

/** Selection offsets for @mention / backspace logic (same semantics as textarea). */
export function getRichInputSelection(el: HTMLElement | null): {
  start: number;
  end: number;
} {
  if (!el) return { start: 0, end: 0 };
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    return { start: 0, end: 0 };
  }
  const range = sel.getRangeAt(0);
  const start = plainTextLengthBefore(
    el,
    range.startContainer,
    range.startOffset
  );
  const end = plainTextLengthBefore(el, range.endContainer, range.endOffset);
  return { start, end };
}
