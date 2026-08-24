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

import { useHost } from '@/host';
import {
  RICH_CONNECTOR_STYLE_CLASSES,
  RICH_SKILL_STYLE_CLASSES,
  RICH_TAG_BASE_STYLE_CLASSES,
  hashSkillLabel,
  httpUrlOrNull,
  isSafeSkillFolderName,
  tokenizeRichPlainText,
} from '@/lib/richText';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Same tokens as `UserMessageCard` body (13px / 20px). */
export const USER_MESSAGE_BODY_STYLE = {
  fontSize: 'var(--fontSize-sm, 13px)',
  lineHeight: 'var(--lineHeight-14, 20px)',
} as const;

const SKILL_TAG_REGEX = /\{\{([^}]+)\}\}/g;

type ContentNode =
  { type: 'text'; value: string } | { type: 'skill'; name: string };

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

function renderMessageRichSegments(
  text: string,
  keyPrefix: string,
  /** When set, URL clicks open here (the session's preview browser) instead
   *  of following the anchor out of the app. */
  onOpenUrl?: (url: string) => void
): ReactNode {
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
            className="text-ds-text-information-default-default underline decoration-ds-border-information-default-default underline-offset-2"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenUrl) {
                e.preventDefault();
                onOpenUrl(href);
              }
            }}
          >
            {seg.text}
          </a>
        );
      }
      return <span key={key}>{seg.text}</span>;
    }
    if (seg.type === 'connector') {
      return (
        <span
          key={key}
          className={cn(
            RICH_TAG_BASE_STYLE_CLASSES,
            RICH_CONNECTOR_STYLE_CLASSES
          )}
        >
          {seg.text}
        </span>
      );
    }
    const clsIdx = hashSkillLabel(seg.text) % RICH_SKILL_STYLE_CLASSES.length;
    return (
      <span
        key={key}
        className={cn(
          RICH_TAG_BASE_STYLE_CLASSES,
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
  const { t } = useTranslation();
  const host = useHost();
  const openBrowserPreview = usePageTabStore((s) => s.openBrowserPreview);
  const contentNodes = parseContentWithTags(content);

  const handleOpenSkillFolder = (skillName: string) => {
    if (!isSafeSkillFolderName(skillName)) return;
    host?.electronAPI?.openSkillFolder?.(skillName);
  };

  // Desktop: links open in this project's preview browser; on the web host
  // (no embedded browser) the anchor's target=_blank fallback applies.
  const handleOpenUrl = host?.electronAPI ? openBrowserPreview : undefined;

  const bodyClass =
    variant === 'card'
      ? 'text-ds-ink-default-default font-sans relative z-0 break-words whitespace-pre-wrap'
      : 'text-ds-ink-muted-default font-sans relative z-0 min-w-0 break-words font-normal line-clamp-1';

  return (
    <div className={cn('min-w-0', className)}>
      <span style={USER_MESSAGE_BODY_STYLE} className={cn('block', bodyClass)}>
        {contentNodes.map((node, i) => {
          if (node.type === 'text') {
            return (
              <Fragment key={i}>
                {renderMessageRichSegments(node.value, `n${i}`, handleOpenUrl)}
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
              title={t('chat.open-skill-folder', {
                defaultValue: 'Open skill folder',
              })}
              className={cn(
                'mx-0 cursor-pointer border-0 border-x-0 border-y-0 [font:inherit] hover:opacity-90',
                RICH_TAG_BASE_STYLE_CLASSES,
                RICH_SKILL_STYLE_CLASSES[clsIdx]
              )}
            >
              <span className="!text-ds-text-base !font-normal">
                {skillToken}
              </span>
            </button>
          );
        })}
      </span>
    </div>
  );
}
