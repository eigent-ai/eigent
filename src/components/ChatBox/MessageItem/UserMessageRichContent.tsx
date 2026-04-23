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
  RICH_SKILL_STYLE_CLASSES,
  hashSkillLabel,
  httpUrlOrNull,
  isSafeSkillFolderName,
  tokenizeRichPlainText,
} from '@/lib/richText';
import { cn } from '@/lib/utils';
import { Fragment, type ReactNode } from 'react';

/** Same tokens as `UserMessageCard` body (13px / 20px). */
export const USER_MESSAGE_BODY_STYLE = {
  fontSize: 'var(--fontSize-sm, 13px)',
  lineHeight: 'var(--lineHeight-14, 20px)',
} as const;

const SKILL_TAG_REGEX = /\{\{([^}]+)\}\}/g;

type ContentNode =
  | { type: 'text'; value: string }
  | { type: 'skill'; name: string };

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
      nodes.push({ type: 'text', value: m[0] });
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

function renderMessageRichSegments(text: string, keyPrefix: string): ReactNode {
  return tokenizeRichPlainText(text).map((seg, i) => {
    const key = `${keyPrefix}-${i}`;
    if (seg.type === 'text') {
      return <span key={key}>{seg.text}</span>;
    }
    if (seg.type === 'url') {
      const href = httpUrlOrNull(seg.text);
      if (href) {
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ds-text-information-default-default decoration-ds-border-information-default-default underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.text}
          </a>
        );
      }
      return <span key={key}>{seg.text}</span>;
    }
    const clsIdx = hashSkillLabel(seg.text) % RICH_SKILL_STYLE_CLASSES.length;
    return (
      <span
        key={key}
        className={cn(
          'rounded px-0.5 font-normal inline align-baseline',
          RICH_SKILL_STYLE_CLASSES[clsIdx]
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
 * Read-only rich body: `{{skill}}`, `#skill`, URLs — matches `UserMessageCard`.
 * `{{@…}}` is shown as plain text until a dedicated mention renderer exists.
 */
export function UserMessageRichContent({
  content,
  variant = 'card',
  className,
}: UserMessageRichContentProps) {
  const contentNodes = parseContentWithTags(content);

  const handleOpenSkillFolder = (skillName: string) => {
    if (!isSafeSkillFolderName(skillName)) return;
    window.electronAPI?.openSkillFolder?.(skillName);
  };

  const bodyClass =
    variant === 'card'
      ? 'text-ds-text-neutral-default-default font-sans relative z-0 break-words whitespace-pre-wrap'
      : 'text-ds-text-neutral-muted-default font-sans relative z-0 min-w-0 break-words font-normal line-clamp-1';

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
          const skillToken = `#${node.name}`;
          const clsIdx =
            hashSkillLabel(skillToken) % RICH_SKILL_STYLE_CLASSES.length;
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
                RICH_SKILL_STYLE_CLASSES[clsIdx]
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
