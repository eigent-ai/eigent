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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ChevronLeft,
  FileText,
  MessageCircleQuestionMark,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BottomBoxContextItem, BottomBoxHeaderContent } from './types';

const contextKindLabel: Record<
  NonNullable<BottomBoxContextItem['kind']>,
  string
> = {
  file: 'File',
  'external-context': 'Context',
  agent: 'Agent',
  operation: 'Operation',
  other: 'Context',
};

/**
 * Display-only context/question region shared by all event-driven input
 * variants. The owner supplies content and callbacks; this component does not
 * know about events, APIs or stores.
 */
export function BoxHeaderDisplay({
  eyebrow,
  title,
  description,
  contextItems = [],
  details = [],
  onRemoveContextItem,
  className,
  descriptionAsTitle = false,
  descriptionAsMarkdown = false,
  showQuestionIcon = false,
}: BottomBoxHeaderContent & {
  className?: string;
  /** Questions use one typographic voice for the label and prompt. */
  descriptionAsTitle?: boolean;
  /** Agent question copy may contain display-safe Markdown. */
  descriptionAsMarkdown?: boolean;
  showQuestionIcon?: boolean;
}) {
  const { t } = useTranslation();
  const hasCopy = Boolean(eyebrow || title || description);
  if (!hasCopy && contextItems.length === 0 && details.length === 0)
    return null;

  return (
    <section
      data-bottom-box-header
      aria-label={title || eyebrow || 'Input context'}
      className={cn('flex w-full flex-col gap-2 px-4 py-2', className)}
    >
      {hasCopy && (
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && (
            <span className="text-ds-text-meta font-medium text-ds-ink-muted-default">
              {eyebrow}
            </span>
          )}
          {title && (
            <span className="flex items-center gap-1.5 text-ds-text-base font-bold text-ds-ink-default-default">
              {showQuestionIcon ? (
                <MessageCircleQuestionMark
                  aria-hidden
                  className="size-4 shrink-0 text-ds-ink-default-default"
                  data-bottom-box-question-icon
                />
              ) : null}
              <span>{title}</span>
            </span>
          )}
          {description && descriptionAsMarkdown ? (
            <div
              className="bottom-box-question-markdown min-w-0 text-ds-text-base text-ds-ink-default-default"
              data-bottom-box-question-markdown
            >
              <MarkDown content={description} enableTypewriter={false} />
            </div>
          ) : description ? (
            <span
              className={
                descriptionAsTitle
                  ? 'block text-ds-text-base font-bold text-ds-ink-default-default'
                  : 'block text-ds-text-meta font-normal text-ds-ink-muted-default'
              }
            >
              {description}
            </span>
          ) : null}
        </div>
      )}

      {contextItems.length > 0 && (
        <ul
          aria-label={t('chat.included-context', {
            defaultValue: 'Included context',
          })}
          className="m-0 flex max-h-24 list-none flex-wrap gap-1 overflow-y-auto p-0"
        >
          {contextItems.map((item) => (
            <li
              key={item.id}
              className="flex max-w-full min-w-0 items-center gap-1 rounded-lg bg-ds-neutral-strong-default px-2 py-1"
            >
              {item.kind === 'file' && (
                <FileText
                  aria-hidden
                  className="size-3.5 shrink-0 text-ds-ink-muted-default"
                />
              )}
              <span className="sr-only">
                {contextKindLabel[item.kind ?? 'other']}:{' '}
              </span>
              <span
                className="truncate text-ds-text-meta font-medium text-ds-ink-default-default"
                title={item.description || item.label}
              >
                {item.label}
              </span>
              {onRemoveContextItem && item.removable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  className="size-5 shrink-0 p-0"
                  aria-label={t('chat.remove-context-item', {
                    value: item.label,
                    defaultValue: 'Remove {{value}}',
                  })}
                  onClick={() => onRemoveContextItem(item.id)}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {details.map((detail) => (
        <details
          key={detail.id}
          className="rounded-xl bg-ds-neutral-strong-default px-3 py-2 text-ds-text-base text-ds-ink-subtle-default"
        >
          <summary className="cursor-pointer font-medium">
            {detail.label}
          </summary>
          <pre className="m-0 mt-2 max-h-40 overflow-auto font-mono text-ds-text-meta break-all whitespace-pre-wrap">
            {detail.content}
          </pre>
        </details>
      ))}
    </section>
  );
}

/**
 * Variant: Confirm
 */
export interface BoxHeaderConfirmProps {
  subtitle?: string;
  onStartTask?: () => void;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
  autoStartDeadline?: number | null;
}

export const BoxHeaderConfirm = ({
  subtitle: _subtitle,
  onStartTask,
  onEdit,
  className,
  loading = false,
  autoStartDeadline = null,
}: BoxHeaderConfirmProps) => {
  const { t } = useTranslation();
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!autoStartDeadline) {
      setRemainingSeconds(null);
      return;
    }

    const updateRemainingSeconds = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((autoStartDeadline - Date.now()) / 1000))
      );
    };

    updateRemainingSeconds();
    const intervalId = window.setInterval(updateRemainingSeconds, 250);
    return () => window.clearInterval(intervalId);
  }, [autoStartDeadline]);

  return (
    <div
      className={cn(
        'mb-2 flex w-full flex-col items-start justify-between gap-1',
        className
      )}
    >
      <div className="relative box-border flex w-full items-center justify-between gap-1 px-2.5 pt-2">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          tone="neutral"
          buttonRadius="full"
          className="focus:ring-0 focus-visible:outline-none"
          onClick={onEdit}
        >
          <ChevronLeft />
        </Button>

        <div className="flex items-center gap-2">
          {remainingSeconds !== null && (
            <span
              className="text-ds-text-meta font-medium whitespace-nowrap text-ds-text-success-default-default tabular-nums"
              aria-label={t('chat.auto-start-in', {
                seconds: remainingSeconds,
              })}
            >
              {t('chat.auto-start-in', { seconds: remainingSeconds })}
            </span>
          )}
          <Button
            variant="primary"
            tone="success"
            size="sm"
            buttonRadius="full"
            onClick={onStartTask}
            disabled={loading}
          >
            {t('chat.start-task')}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Variant: Save
 *
 * Mirrors `BoxHeaderConfirm` but the primary action is "Save" — used when the
 * plan editor has unsaved subtask edits.
 */
export interface BoxHeaderSaveProps {
  subtitle?: string;
  onSave?: () => void;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
}

export const BoxHeaderSave = ({
  subtitle: _subtitle,
  onSave,
  onEdit,
  className,
  loading = false,
}: BoxHeaderSaveProps) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-2 flex w-full flex-col items-start justify-between gap-1',
        className
      )}
    >
      <div className="relative box-border flex w-full items-center justify-between gap-1 px-2.5 pt-2">
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          tone="neutral"
          buttonRadius="full"
          className="focus:ring-0 focus-visible:outline-none"
          onClick={onEdit}
        >
          <ChevronLeft />
        </Button>

        <Button
          variant="primary"
          tone="success"
          size="sm"
          buttonRadius="full"
          onClick={onSave}
          disabled={loading}
        >
          {t('layout.save')}
        </Button>
      </div>
    </div>
  );
};
