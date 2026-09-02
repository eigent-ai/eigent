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
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type SearchInputVariant = 'default' | 'icon';
export type SearchInputColor = 'default-default' | 'subtle-default';

interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  variant?: SearchInputVariant;
  /** Neutral fill. Defaults to `default-default`. */
  color?: SearchInputColor;
  /** Optional: called when user presses Enter in the field (e.g. to submit search) */
  onSearch?: () => void;
  /** Tooltip for the search icon button (icon variant). Defaults to agents.search-tooltip */
  searchTooltip?: string;
  /** Tooltip for the clear (X) button (icon variant). Defaults to agents.clear-search-tooltip */
  clearTooltip?: string;
  /** Accessible name for the field. Falls back to the placeholder. */
  ariaLabel?: string;
  /** Opt in to Escape clearing the field, for filters rendered inline. */
  clearOnEscape?: boolean;
}

const COLLAPSED_WIDTH = 28;
const EXPANDED_WIDTH = 240;

export default function SearchInput({
  value: rawValue,
  onChange,
  placeholder,
  variant = 'default',
  color = 'default-default',
  onSearch,
  searchTooltip,
  clearTooltip,
  ariaLabel,
  clearOnEscape = false,
}: SearchInputProps) {
  const { t } = useTranslation();
  const value = rawValue ?? '';
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
          'flex items-center justify-center overflow-hidden rounded-lg border border-x border-y border-solid border-transparent bg-transparent py-0.5',
          'focus-within:border-ds-ring-focus focus-within:bg-ds-neutral-strong-default',
          'hover:border-transparent hover:bg-ds-neutral-strong-hover'
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
              <TooltipSimple
                content={searchLabel}
                variant="instant"
                side="bottom"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
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
              className="flex min-w-0 flex-1 items-center gap-0 pr-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <span className="pointer-events-none ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center text-ds-ink-muted-default">
                <Search className="h-4 w-4" />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={onChange}
                placeholder={place}
                aria-label={ariaLabel ?? place}
                onBlur={() => {
                  if (value.length === 0) setUserExpanded(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSearch?.();
                  }
                  if (e.key === 'Escape' && clearOnEscape) {
                    collapse();
                  }
                }}
                className="h-6 min-w-0 flex-1 bg-transparent pl-2 text-ds-text-base text-ds-ink-default-default outline-none placeholder:text-ds-ink-muted-default"
              />
              <TooltipSimple
                content={clearLabel}
                variant="instant"
                side="bottom"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  className="shrink-0 rounded-full text-ds-ink-muted-default"
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
    <div
      className={cn(
        'relative flex h-ds-control-sm min-h-ds-control-sm w-full items-center gap-ds-6 rounded-ds-field border-0 border-x-0 border-y-0 px-ds-8 transition-colors',
        // The ring lives on the wrapper but must follow DS_FOCUS_RING's
        // focus-visible semantics, so it is keyed off the inner input.
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ds-ring-focus has-[:focus-visible]:ring-offset-2',
        color === 'subtle-default'
          ? 'bg-ds-neutral-subtle-default focus-within:bg-ds-neutral-subtle-hover hover:bg-ds-neutral-subtle-hover'
          : 'bg-ds-neutral-default-default focus-within:bg-ds-neutral-default-hover hover:bg-ds-neutral-default-hover'
      )}
    >
      <span className="leading-icon-wrapper pointer-events-none inline-flex shrink-0 items-center justify-center text-ds-ink-muted-default">
        <Search className="size-ds-icon-sm" />
      </span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={place}
        aria-label={ariaLabel ?? place}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSearch?.();
          }
          if (event.key === 'Escape' && clearOnEscape) {
            onChange({
              target: { value: '' },
            } as React.ChangeEvent<HTMLInputElement>);
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-ds-text-base text-ds-ink-default-default outline-none placeholder:text-ds-ink-muted-default"
      />
    </div>
  );
}
