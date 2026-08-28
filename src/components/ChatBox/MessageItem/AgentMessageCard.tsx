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

import { fileInfoFromPath } from '@/lib/fileInfo';
import { usePageTabStore } from '@/store/pageTabStore';
import { Check, Copy, FileText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { MarkDown } from './MarkDown';

const COPIED_RESET_MS = 2000;

type MessageFeedback = 'up' | 'down' | null;

interface AgentMessageCardProps {
  id: string;
  content: string;
  className?: string;
  typewriter?: boolean;
  attaches?: File[];
  /** Shown only after markdown (and typewriter, if enabled) has finished rendering — e.g. generated file chips. */
  deferredFooter?: ReactNode;
  onTyping?: () => void;
  onMarkdownRenderComplete?: () => void;
}

// Tracks agent messages that have already played the typewriter (by stable message id).
const completedTypewriterByMessageId = new Map<string, boolean>();

export function AgentMessageCard({
  id,
  content,
  typewriter = true,
  onTyping,
  onMarkdownRenderComplete,
  className,
  attaches,
  deferredFooter,
}: AgentMessageCardProps) {
  const openFilePreview = usePageTabStore((s) => s.openFilePreview);
  const [markdownAndTypingComplete, setMarkdownAndTypingComplete] = useState(
    () => completedTypewriterByMessageId.has(id)
  );

  useEffect(() => {
    setMarkdownAndTypingComplete(completedTypewriterByMessageId.has(id));
  }, [id]);

  const isCompleted = completedTypewriterByMessageId.has(id);
  const enableTypewriter = !isCompleted;

  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<MessageFeedback>(null);
  const { t } = useTranslation();

  useEffect(() => {
    setFeedback(null);
  }, [id]);

  const handleTypingComplete = () => {
    if (!completedTypewriterByMessageId.has(id)) {
      completedTypewriterByMessageId.set(id, true);
    }
    if (onTyping) {
      onTyping();
    }
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t('setting.copied-to-clipboard'));
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error(
        t('setting.copy-failed', {
          defaultValue: 'Failed to copy to clipboard',
        })
      );
    }
  }, [content, t]);

  const handleMarkdownRenderComplete = useCallback(() => {
    setMarkdownAndTypingComplete(true);
    onMarkdownRenderComplete?.();
  }, [onMarkdownRenderComplete]);

  const handleThumbUp = useCallback(() => {
    if (feedback !== null) return;
    setFeedback('up');
    toast.success(
      t('chat.feedback-thanks', { defaultValue: 'Thanks for your feedback' })
    );
  }, [feedback, t]);

  const handleThumbDown = useCallback(() => {
    if (feedback !== null) return;
    setFeedback('down');
    toast.success(
      t('chat.feedback-thanks', { defaultValue: 'Thanks for your feedback' })
    );
  }, [feedback, t]);

  const showDeferredFileUi =
    markdownAndTypingComplete &&
    ((attaches && attaches.length > 0) || deferredFooter != null);

  return (
    <div
      key={id}
      className={`flex w-full flex-col rounded-xl bg-transparent py-3 ${className || ''} overflow-hidden`}
    >
      <MarkDown
        content={content}
        onTyping={handleTypingComplete}
        onMarkdownRenderComplete={handleMarkdownRenderComplete}
        enableTypewriter={enableTypewriter && typewriter}
      />
      {showDeferredFileUi && attaches && attaches.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {attaches?.map((file) => {
            return (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  openFilePreview(
                    fileInfoFromPath(file.filePath, file.fileName)
                  );
                }}
                key={'attache-' + file.fileName}
                className="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default py-1 pl-2"
              >
                <FileText size={24} className="shrink-0" />
                <div className="flex flex-col">
                  <span className="block max-w-48 overflow-hidden text-ds-text-base font-bold text-ellipsis whitespace-nowrap text-ds-ink-default-default">
                    {file?.fileName?.split('.')[0]}
                  </span>
                  <span className="block text-ds-text-meta font-medium text-ds-ink-muted-default">
                    {file?.fileName?.split('.')[1]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showDeferredFileUi && deferredFooter != null && (
        <div className="mt-2.5 w-full">{deferredFooter}</div>
      )}
      {markdownAndTypingComplete && (
        <div className="mt-3 flex shrink-0 justify-start gap-1">
          <Button
            onClick={handleCopy}
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('setting.copy')}
          >
            {copied ? (
              <Check className="h-4 w-4 text-ds-text-success-default-default" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            onClick={handleThumbUp}
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('chat.thumbs-up', { defaultValue: 'Thumb up' })}
            aria-pressed={feedback === 'up'}
            disabled={feedback === 'down'}
          >
            <ThumbsUp
              className={`h-4 w-4 ${feedback === 'up' ? 'text-ds-accent-default-default' : ''}`}
            />
          </Button>
          <Button
            onClick={handleThumbDown}
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('chat.thumbs-down', { defaultValue: 'Thumb down' })}
            aria-pressed={feedback === 'down'}
            disabled={feedback === 'up'}
          >
            <ThumbsDown
              className={`h-4 w-4 ${feedback === 'down' ? 'text-ds-accent-default-default' : ''}`}
            />
          </Button>
        </div>
      )}
    </div>
  );
}
