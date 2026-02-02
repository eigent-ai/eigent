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

import { Copy, FileText } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '../../ui/button';
import { MarkDown } from './MarkDown';

interface AgentMessageCardProps {
  id: string;
  content: string;
  className?: string;
  typewriter?: boolean;
  attaches?: File[];
  onTyping?: () => void;
}

// global Map to track completed typewriter effect content hash
const completedTypewriterHashes = new Map<string, boolean>();

export function AgentMessageCard({
  id,
  content,
  typewriter = true,
  onTyping,
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

  // when typewriter effect is completed, record to global Map
  const handleTypingComplete = () => {
    if (!isCompleted) {
      completedTypewriterHashes.set(contentHash, true);
    }
    if (onTyping) {
      onTyping();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  return (
    <div
      key={id}
      className={`bg-white-0% relative w-full rounded-xl border px-sm py-3 ${className || ''} group overflow-hidden`}
    >
      <div className="absolute bottom-[0px] right-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <Button onClick={handleCopy} variant="ghost" size="icon">
          <Copy />
        </Button>
      </div>
      <MarkDown
        content={content}
        onTyping={handleTypingComplete}
        enableTypewriter={enableTypewriter && typewriter}
      />
      {attaches && attaches.length > 0 && (
        <div className="mt-[10px] flex flex-wrap gap-2">
          {attaches?.map((file) => {
            return (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  window.ipcRenderer.invoke('reveal-in-folder', file.filePath);
                }}
                key={'attache-' + file.fileName}
                className="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-solid border-task-border-default bg-message-fill-default py-1 pl-2"
              >
                <FileText size={24} className="flex-shrink-0" />
                <div className="flex flex-col">
                  <div className="text-body max-w-48 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-text-body">
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
    </div>
  );
}
