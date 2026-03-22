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

export function NoticeCard() {
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
      console.log('contentRef.current', contentRef.current);
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
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="flex h-auto w-full flex-col gap-2 py-sm transition-all duration-300">
        <div className="relative h-auto w-full overflow-hidden rounded-xl py-3 pr-5 backdrop-blur-[5px]">
          <div className="relative">
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-[-15px] top-0"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-300 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </Button>
            <div
              ref={contentRef}
              className={`${
                isExpanded ? 'overflow-y-auto' : 'max-h-[200px] overflow-y-auto'
              } scrollbar-hide relative transition-all duration-300 ease-in-out`}
              style={{
                maskImage: isExpanded
                  ? 'none'
                  : 'linear-gradient(to top, black 0%, black 40%, transparent 100%)',
                WebkitMaskImage: isExpanded
                  ? 'none'
                  : 'linear-gradient(to top, black 0%, black 40%, transparent 100%)',
              }}
            >
              <div className="mt-sm flex flex-col gap-2 px-2">
                {cotList.map((cot: string, index: number) => {
                  return (
                    <div
                      key={`taskList-${index}`}
                      className={`flex cursor-pointer gap-2 rounded-lg border border-solid border-transparent transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2`}
                    >
                      <div className="m-1.5 mt-2 h-1 w-1 rounded-full bg-icon-primary"></div>
                      <div className="flex flex-1 flex-col items-start justify-center text-sm font-normal leading-normal">
                        {cot}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
