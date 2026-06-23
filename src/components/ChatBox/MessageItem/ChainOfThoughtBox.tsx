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

import type { ChainOfThoughtItem } from '@/types/sessionChannel';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface ChainOfThoughtBoxProps {
  item: ChainOfThoughtItem;
  /** True while the parent task is still running (drives cursor blink). */
  isStreaming: boolean;
}

/**
 * Fixed-height 100px scrollable box that renders chain-of-thought reasoning.
 * New entries slide in from below and the scroll position tracks the bottom
 * while content is streaming.
 */
export function ChainOfThoughtBox({
  item,
  isStreaming,
}: ChainOfThoughtBoxProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow new content to the bottom while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [item.cot.length]);

  if (!item.cot.length && !isStreaming) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-6 rounded-xl bg-ds-bg-neutral-subtle-default overflow-hidden"
    >
      {/* Header row */}
      <div className="gap-1.5 px-3 pt-2.5 pb-1 flex items-center">
        <Brain
          size={11}
          className="text-ds-icon-neutral-muted-default shrink-0"
        />
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {isStreaming ? 'Thinking' : 'Thought'}
        </span>
        {isStreaming && (
          <span className="h-1.5 w-1.5 animate-pulse bg-ds-icon-neutral-muted-default inline-block rounded-full" />
        )}
      </div>

      {/* Scrollable content — fixed 100px height */}
      <div
        ref={scrollRef}
        className="scrollbar-hide px-3 pb-2.5 h-[100px] overflow-y-auto"
      >
        <div className="gap-0.5 flex flex-col">
          <AnimatePresence initial={false}>
            {item.cot.map((line, i) => (
              <motion.p
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="text-label-xs font-normal text-ds-text-neutral-muted-default leading-[18px]"
              >
                {line}
              </motion.p>
            ))}
          </AnimatePresence>

          {/* Blinking cursor while streaming */}
          {isStreaming && (
            <span
              aria-hidden
              className="mt-0.5 h-3 w-0.5 animate-pulse bg-ds-icon-neutral-muted-default inline-block rounded-full"
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
