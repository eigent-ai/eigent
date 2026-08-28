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

import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function NoticeCard() {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();

  // Extract complex expression to avoid lint error
  const activeTaskId = chatStore?.activeTaskId as string;
  const cotList = useMemo(
    () => chatStore?.tasks[activeTaskId]?.cotList || [],
    [chatStore, activeTaskId]
  );
  const cotListLength = cotList.length;

  // when cotList is added, smooth scroll to the bottom
  useEffect(() => {
    if (!isExpanded && contentRef.current) {
      // use setTimeout to ensure DOM update is completed before scrolling
      setTimeout(() => {
        const container = contentRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        }
      }, 100);
    }
  }, [cotListLength, isExpanded]);

  if (!chatStore) {
    return (
      <span className="block px-4 py-3 text-ds-text-base font-normal text-ds-ink-muted-default">
        {t('chat.loading', { defaultValue: 'Loading…' })}
      </span>
    );
  }

  return (
    <section className="relative w-full overflow-hidden rounded-xl px-4 py-3 backdrop-blur-[5px]">
      <Button
        size="xs"
        buttonContent="icon-only"
        variant="ghost"
        className="absolute top-2 right-2 z-10"
        aria-label={
          isExpanded
            ? t('chat.agent-outcome-collapse')
            : t('chat.agent-outcome-expand')
        }
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <ChevronDown
          size={16}
          className={`transition-transform duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </Button>
      <div
        ref={contentRef}
        className={`${
          isExpanded ? 'overflow-y-auto' : 'max-h-[200px] overflow-y-auto'
        } scrollbar-hide relative pr-7`}
        style={{
          maskImage: isExpanded
            ? 'none'
            : 'linear-gradient(to top, black 0%, black 40%, transparent 100%)',
          WebkitMaskImage: isExpanded
            ? 'none'
            : 'linear-gradient(to top, black 0%, black 40%, transparent 100%)',
        }}
      >
        <div className="flex flex-col gap-2">
          {cotList.map((cot: string, index: number) => (
            <div
              key={`taskList-${index}`}
              className="flex items-start gap-2 rounded-lg border border-x border-y border-solid border-transparent duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] animate-in fade-in-0 slide-in-from-left-2"
            >
              <span
                aria-hidden
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ds-ink-muted-default"
              />
              <span className="min-w-0 flex-1 text-ds-text-base font-normal text-ds-ink-subtle-default">
                {cot}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
