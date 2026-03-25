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
import React, { useCallback, useEffect, useRef } from 'react';

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

function getPlainTextFromRoot(root: HTMLElement): string {
  const html = root.innerHTML;
  if (!html || html === '<br>' || html === '<br/>' || html === '<br />') {
    return '';
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('br').forEach((br) => {
    br.replaceWith(document.createTextNode('\n'));
  });
  return tmp.innerText.replace(/\u00a0/g, ' ');
}

function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
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

export interface RichChatInputProps {
  value: string;
  onChange: (value: string, cursorOffset?: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  disabled?: boolean;
  placeholder?: string;
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
    const html =
      plain.length === 0 ? '' : segmentsToHtml(tokenizeRichPlainText(plain));
    el.innerHTML = html || '<br />';
    if (restoreOffset !== undefined) {
      requestAnimationFrame(() => {
        setCaretOffset(el, Math.min(restoreOffset, plain.length));
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

  const showPlaceholder = value.length === 0;

  return (
    <div
      ref={setRootRef}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
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
        showPlaceholder &&
          'before:left-1 before:top-0 before:text-text-label before:pointer-events-none before:absolute before:z-0 before:font-[Inter] before:text-[13px] before:leading-[20px] before:content-[attr(data-placeholder)]',
        disabled && 'cursor-not-allowed opacity-60',
        textClassName,
        className
      )}
      style={style}
      data-placeholder={placeholder ?? ''}
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
  const preStart = range.cloneRange();
  preStart.selectNodeContents(el);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;
  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(el);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;
  return { start, end };
}
