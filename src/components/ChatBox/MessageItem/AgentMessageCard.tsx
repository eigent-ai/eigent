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

import { Check, Copy, FileText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { MarkDown } from './MarkDown';

const COPIED_RESET_MS = 2000;

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
  const [markdownAndTypingComplete, setMarkdownAndTypingComplete] = useState(
    () => completedTypewriterByMessageId.has(id)
  );

  useEffect(() => {
    setMarkdownAndTypingComplete(completedTypewriterByMessageId.has(id));
  }, [id]);

  const isCompleted = completedTypewriterByMessageId.has(id);
  const enableTypewriter = !isCompleted;

  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

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
      toast.error('Failed to copy to clipboard');
    }
  }, [content, t]);

  const handleMarkdownRenderComplete = useCallback(() => {
    setMarkdownAndTypingComplete(true);
    onMarkdownRenderComplete?.();
  }, [onMarkdownRenderComplete]);

  const showDeferredFileUi =
    markdownAndTypingComplete &&
    ((attaches && attaches.length > 0) || deferredFooter != null);

  return (
    <div
      key={id}
      className={`rounded-xl px-sm py-3 flex w-full flex-col bg-transparent ${className || ''} overflow-hidden`}
    >
      <MarkDown
        content={content}
        onTyping={handleTypingComplete}
        onMarkdownRenderComplete={handleMarkdownRenderComplete}
        enableTypewriter={enableTypewriter && typewriter}
      />
      {showDeferredFileUi && attaches && attaches.length > 0 && (
        <div className="gap-2 mt-[10px] flex flex-wrap">
          {attaches?.map((file) => {
            return (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  window.ipcRenderer.invoke('reveal-in-folder', file.filePath);
                }}
                key={'attache-' + file.fileName}
                className="gap-2 rounded-2xl py-1 pl-2 flex w-full cursor-pointer items-center border border-solid border-[color:var(--ds-border-neutral-subtle-default)] bg-[var(--ds-bg-neutral-default-default)]"
              >
                <FileText size={24} className="flex-shrink-0" />
                <div className="flex flex-col">
                  <div className="text-body max-w-48 text-sm font-bold overflow-hidden text-ellipsis whitespace-nowrap text-[color:var(--ds-text-neutral-default-default)]">
                    {file?.fileName?.split('.')[0]}
                  </div>
                  <div className="text-xs font-medium leading-29 text-[color:var(--ds-text-neutral-default-default)]">
                    {file?.fileName?.split('.')[1]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showDeferredFileUi && deferredFooter != null && (
        <div className="mt-[10px] w-full">{deferredFooter}</div>
      )}
      {markdownAndTypingComplete && (
        <div className="mt-3 gap-1 flex shrink-0 justify-start">
          <Button
            onClick={handleCopy}
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label={t('setting.copy')}
          >
            {copied ? (
              <Check className="h-4 w-4 text-[color:var(--ds-text-success-default-default)]" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            onClick={() => {}}
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label="Thumb up"
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => {}}
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label="Thumb down"
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
