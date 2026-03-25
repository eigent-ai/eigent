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
import { Fragment, type ReactNode } from 'react';

/** Same tokens as `UserMessageCard` body (13px / 20px). */
export const USER_MESSAGE_BODY_STYLE = {
  fontSize: 'var(--fontSize-sm, 13px)',
  lineHeight: 'var(--lineHeight-14, 20px)',
} as const;

type MessageRichSegment = { type: 'text' | 'url' | 'skill'; text: string };

const MESSAGE_SKILL_STYLE_CLASSES = [
  'text-text-information bg-surface-information/35',
  'text-text-success bg-surface-success/25',
  'text-text-warning bg-surface-warning/35',
  'text-icon-information bg-surface-action/20',
] as const;

function hashMessageSkillLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h << 5) - h + label.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function trimMessageUrlTail(raw: string): string {
  return raw.replace(/[`'".,;:!?)\]]+$/g, '');
}

const MESSAGE_URL_AT_START = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i;

function tokenizeMessagePlainText(text: string): MessageRichSegment[] {
  const out: MessageRichSegment[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const slice = text.slice(i);
    const urlMatch = slice.match(MESSAGE_URL_AT_START);
    if (urlMatch) {
      const full = urlMatch[0];
      const trimmed = trimMessageUrlTail(full);
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
      if (MESSAGE_URL_AT_START.test(tail)) break;
      if (text[j] === '#' && /^#([a-zA-Z0-9_-]+)/.test(tail)) break;
      j++;
    }
    out.push({ type: 'text', text: text.slice(i, j) });
    i = j;
  }

  return out;
}

function messageHttpUrlOrNull(raw: string): string | null {
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

const SKILL_TAG_REGEX = /\{\{([^}]+)\}\}/g;

type ContentNode =
  | { type: 'text'; value: string }
  | { type: 'skill'; name: string }
  | { type: 'mention'; id: string };

function parseContentWithTags(content: string): ContentNode[] {
  const nodes: ContentNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  SKILL_TAG_REGEX.lastIndex = 0;
  while ((m = SKILL_TAG_REGEX.exec(content)) !== null) {
    if (m.index > lastIndex) {
      nodes.push({ type: 'text', value: content.slice(lastIndex, m.index) });
    }
    const inner = m[1].trim();
    if (inner.startsWith('@')) {
      nodes.push({ type: 'mention', id: inner.slice(1) });
    } else {
      nodes.push({ type: 'skill', name: inner });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return nodes.length > 0 ? nodes : [{ type: 'text', value: content }];
}

const MENTION_LABELS: Record<string, string> = {
  workforce: 'Workforce',
  browser: 'Browser Agent',
  dev: 'Developer Agent',
  doc: 'Document Agent',
  media: 'Multi Modal Agent',
};

const MENTION_TEXT_CLASS: Record<string, string> = {
  workforce: 'text-text-camel',
  browser: 'text-text-browser',
  dev: 'text-text-developer',
  doc: 'text-text-document',
  media: 'text-text-multimodal',
};

function renderMessageRichSegments(text: string, keyPrefix: string): ReactNode {
  return tokenizeMessagePlainText(text).map((seg, i) => {
    const key = `${keyPrefix}-${i}`;
    if (seg.type === 'text') {
      return <span key={key}>{seg.text}</span>;
    }
    if (seg.type === 'url') {
      const href = messageHttpUrlOrNull(seg.text);
      if (href) {
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-information decoration-text-information/80 underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.text}
          </a>
        );
      }
      return <span key={key}>{seg.text}</span>;
    }
    const clsIdx =
      hashMessageSkillLabel(seg.text) % MESSAGE_SKILL_STYLE_CLASSES.length;
    return (
      <span
        key={key}
        className={cn(
          'rounded px-0.5 font-normal inline align-baseline',
          MESSAGE_SKILL_STYLE_CLASSES[clsIdx]
        )}
      >
        {seg.text}
      </span>
    );
  });
}

export type UserMessageRichVariant = 'card' | 'compact';

export interface UserMessageRichContentProps {
  content: string;
  variant?: UserMessageRichVariant;
  className?: string;
}

/**
 * Read-only rich body: `{{@agent}}`, `{{skill}}`, `#skill`, URLs — matches `UserMessageCard`.
 */
export function UserMessageRichContent({
  content,
  variant = 'card',
  className,
}: UserMessageRichContentProps) {
  const contentNodes = parseContentWithTags(content);

  const handleOpenSkillFolder = (skillName: string) => {
    window.electronAPI?.openSkillFolder?.(skillName);
  };

  const bodyClass =
    variant === 'card'
      ? 'text-text-body font-sans relative z-0 break-words whitespace-pre-wrap'
      : 'text-text-label font-sans relative z-0 min-w-0 break-words font-normal line-clamp-1';

  return (
    <div className={cn('min-w-0', className)}>
      <div style={USER_MESSAGE_BODY_STYLE} className={bodyClass}>
        {contentNodes.map((node, i) => {
          if (node.type === 'text') {
            return (
              <Fragment key={i}>
                {renderMessageRichSegments(node.value, `n${i}`)}
              </Fragment>
            );
          }
          if (node.type === 'mention') {
            const label = MENTION_LABELS[node.id] ?? node.id;
            return (
              <span
                key={i}
                className={cn(
                  'font-normal inline align-baseline',
                  MENTION_TEXT_CLASS[node.id] ?? 'text-text-body'
                )}
              >
                @{label}
              </span>
            );
          }
          const skillToken = `#${node.name}`;
          const clsIdx =
            hashMessageSkillLabel(skillToken) %
            MESSAGE_SKILL_STYLE_CLASSES.length;
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSkillFolder(node.name);
              }}
              title="Open skill folder"
              className={cn(
                'mx-0 rounded px-0.5 font-normal inline cursor-pointer align-baseline [font:inherit] hover:opacity-90',
                MESSAGE_SKILL_STYLE_CLASSES[clsIdx]
              )}
            >
              {skillToken}
            </button>
          );
        })}
      </div>
    </div>
  );
}
