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

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Inputbox, InputboxProps } from './InputBox';

/**
 * Prompt example for ActionBox
 */
interface PromptExample {
  title: string;
  prompt: string;
}

// TODO: Add prompt examples here
const defaultPromptExamples: PromptExample[] = [];

/**
 * ExpandedInputBox Props
 */
export interface ExpandedInputBoxProps {
  /** Props to pass through to Inputbox */
  inputProps: InputboxProps;
  /** Callback when close is triggered */
  onClose?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * ExpandedInputBox Component
 *
 * A larger input panel for composing longer messages.
 * Close/collapse uses the same control as expand in Inputbox (minimize icon).
 */
export const ExpandedInputBox = ({
  inputProps,
  onClose,
  className,
}: ExpandedInputBoxProps) => {
  const handlePromptClick = (prompt: string) => {
    inputProps.onChange?.(prompt);
  };

  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="inset-0 bg-black/30 p-4 fixed z-30 flex items-center justify-center"
      onClick={() => onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          'relative w-full max-w-[760px] min-w-[min(600px,100%)]',
          'rounded-3xl border-border-tertiary bg-surface-primary backdrop-blur-md border border-solid',
          'perfect-shadow',
          'flex flex-col',
          className
        )}
        style={{ transformOrigin: 'center center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-3 flex-1">
          <Inputbox
            {...inputProps}
            className={cn('min-h-40', inputProps.className)}
            isExpandedInput
            onCollapseExpanded={onClose}
          />
        </div>

        {/* ActionBox - Prompt Examples Always Visible */}
        <div className="border-border-tertiary border-t">
          <div className="scrollbar-hide px-4 py-3 overflow-x-auto">
            <div className="gap-2 flex">
              {defaultPromptExamples.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handlePromptClick(example.prompt)}
                  className={cn(
                    'w-48 rounded-xl p-3 flex-shrink-0',
                    'border-border-tertiary bg-surface-tertiary border',
                    'hover:bg-surface-tertiary-hover hover:border-border-secondary',
                    'transition-all duration-200',
                    'text-left'
                  )}
                >
                  <div className="mb-1 text-xs font-medium text-text-body">
                    {example.title}
                  </div>
                  <div className="text-xs text-text-label line-clamp-2">
                    {example.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
