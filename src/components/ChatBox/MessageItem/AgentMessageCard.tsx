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

import { Check, Copy, FileText } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
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
  onTyping?: () => void;
  onMarkdownRenderComplete?: () => void;
}

// global Map to track completed typewriter effect content hash
const completedTypewriterHashes = new Map<string, boolean>();

export function AgentMessageCard({
  id,
  content,
  typewriter = true,
  onTyping,
  onMarkdownRenderComplete,
  className,
  attaches,
}: AgentMessageCardProps) {
  // use content hash to track if typewriter effect is completed
  const contentHash = useMemo(() => {
    return `${id}-${content}`;
  }, [id, content]);

  // check if typewriter effect is completed
  const isCompleted = completedTypewriterHashes.has(contentHash);

  // if completed, disable typewriter effect
  const enableTypewriter = !isCompleted;

  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  // when typewriter effect is completed, record to global Map
  const handleTypingComplete = () => {
    if (!isCompleted) {
      completedTypewriterHashes.set(contentHash, true);
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

  return (
    <div
      key={id}
      className={`rounded-xl px-sm py-3 flex w-full flex-col bg-transparent ${className || ''} group overflow-hidden`}
    >
      <MarkDown
        content={content}
        onTyping={handleTypingComplete}
        onMarkdownRenderComplete={onMarkdownRenderComplete}
        enableTypewriter={enableTypewriter && typewriter}
      />
      {attaches && attaches.length > 0 && (
        <div className="gap-2 mt-[10px] flex flex-wrap">
          {attaches?.map((file) => {
            return (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  window.ipcRenderer.invoke('reveal-in-folder', file.filePath);
                }}
                key={'attache-' + file.fileName}
                className="gap-2 rounded-2xl border-task-border-default bg-message-fill-default py-1 pl-2 flex w-full cursor-pointer items-center border border-solid"
              >
                <FileText size={24} className="flex-shrink-0" />
                <div className="flex flex-col">
                  <div className="text-body max-w-48 text-sm font-bold text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
                    {file?.fileName?.split('.')[0]}
                  </div>
                  <div className="text-xs font-medium leading-29 text-text-body">
                    {file?.fileName?.split('.')[1]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex shrink-0 justify-end">
        <div className="pointer-events-none opacity-0 transition-opacity duration-300 group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            onClick={handleCopy}
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
          >
            {copied ? (
              <Check className="h-4 w-4 text-text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
