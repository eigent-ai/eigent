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
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type SearchInputVariant = 'default' | 'icon';

interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  variant?: SearchInputVariant;
  /** Optional: called when user presses Enter in the field (e.g. to submit search) */
  onSearch?: () => void;
  /** Tooltip for the search icon button (icon variant). Defaults to agents.search-tooltip */
  searchTooltip?: string;
  /** Tooltip for the clear (X) button (icon variant). Defaults to agents.clear-search-tooltip */
  clearTooltip?: string;
}

const COLLAPSED_WIDTH = 40;
const EXPANDED_WIDTH = 240;

export default function SearchInput({
  value,
  onChange,
  placeholder,
  variant = 'default',
  onSearch,
  searchTooltip,
  clearTooltip,
}: SearchInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [userExpanded, setUserExpanded] = useState(false);
  const isExpanded = userExpanded || value.length > 0;

  const expand = useCallback(() => {
    setUserExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    setUserExpanded(false);
    onChange({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);
  }, [onChange]);

  useEffect(() => {
    if (userExpanded) {
      // Delay focus until input is mounted (AnimatePresence mode="wait" ~150ms)
      const id = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(id);
    }
  }, [userExpanded]);

  const searchLabel = searchTooltip ?? t('agents.search-tooltip');
  const clearLabel = clearTooltip ?? t('agents.clear-search-tooltip');
  const place = placeholder ?? t('setting.search-mcp');

  if (variant === 'icon') {
    return (
      <motion.div
        className={cn(
          'rounded-lg py-0.5 flex items-center justify-center overflow-hidden border border-solid border-transparent bg-transparent',
          'focus-within:border-input-border-focus focus-within:bg-input-bg-input',
          'hover:bg-surface-tertiary hover:border-transparent'
        )}
        initial={false}
        animate={{ width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 30,
        }}
      >
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            <motion.div
              key="icon"
              className="flex shrink-0 items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <TooltipSimple content={searchLabel}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={expand}
                  aria-label={searchLabel}
                >
                  <Search />
                </Button>
              </TooltipSimple>
            </motion.div>
          ) : (
            <motion.div
              key="input"
              className="min-w-0 gap-0 pr-1 flex flex-1 items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <span className="ml-2 h-4 w-4 text-icon-secondary pointer-events-none inline-flex shrink-0 items-center justify-center">
                <Search className="h-4 w-4" />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={onChange}
                placeholder={place}
                onBlur={() => {
                  if (value.length === 0) setUserExpanded(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSearch?.();
                  }
                }}
                className="h-6 min-w-0 pl-2 text-label-sm text-text-heading placeholder:text-text-label flex-1 bg-transparent outline-none"
              />
              <TooltipSimple content={clearLabel}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-icon-secondary shrink-0 rounded-full"
                  onClick={collapse}
                  aria-label={clearLabel}
                >
                  <X />
                </Button>
              </TooltipSimple>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <div className="relative w-full">
      <Input
        size="sm"
        value={value}
        onChange={onChange}
        placeholder={place}
        leadingIcon={<Search className="h-5 w-5 text-icon-secondary" />}
      />
    </div>
  );
}
