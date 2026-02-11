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

import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  allowCustomValue?: boolean;
  onOpenChange?: (open: boolean) => void;
  loading?: boolean;
  title?: string;
  state?: 'default' | 'error' | 'success';
  note?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select option...',
  emptyText = 'No option found.',
  searchPlaceholder = 'Search...',
  disabled = false,
  className,
  allowCustomValue = false,
  onOpenChange,
  loading = false,
  title,
  state,
  note,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      // When closing, if allowCustomValue and user has typed something
      // that doesn't match an option, commit it as a custom value
      if (allowCustomValue && searchValue && searchValue !== value) {
        const matchesOption = options.some(
          (opt) => opt.value.toLowerCase() === searchValue.toLowerCase()
        );
        if (!matchesOption) {
          onValueChange?.(searchValue);
        }
      }
      // Reset search when closing
      setSearchValue('');
    }
  };

  const selectedOption = options.find((option) => option.value === value);

  const handleSelect = (selectedValue: string) => {
    onValueChange?.(selectedValue);
    setSearchValue('');
    setOpen(false);
  };

  const stateClasses =
    state === 'error'
      ? 'border-input-border-caution bg-input-bg-default'
      : state === 'success'
        ? 'border-input-border-success bg-input-bg-confirm'
        : 'border-input-border-default bg-input-bg-default';

  return (
    <div className={cn('w-full', disabled && 'cursor-not-allowed opacity-50')}>
      {title ? (
        <div className="mb-1.5 text-body-sm font-bold text-text-heading">
          {title}
        </div>
      ) : null}

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            role="combobox"
            aria-expanded={open}
            className={cn(
              // Match SelectTrigger styling
              'relative flex w-full items-center justify-between gap-2 rounded-lg border border-solid px-3 text-text-body outline-none transition-colors',
              'h-10 text-body-sm',
              'whitespace-nowrap [&>span]:line-clamp-1',
              // State-based colors
              stateClasses,
              // Interactive states (only when no error state)
              state !== 'error' && [
                'hover:border-input-border-hover hover:bg-input-bg-hover',
                'focus-visible:ring-0 data-[state=open]:bg-input-bg-input',
                'focus-within:border-input-border-focus',
              ],
              className
            )}
            disabled={disabled}
            type="button"
          >
            <span
              className={cn(
                'truncate text-left',
                !selectedOption && !value && 'text-input-label-default/50'
              )}
            >
              {loading
                ? 'Loading...'
                : selectedOption
                  ? selectedOption.label
                  : value || placeholder}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-icon-primary" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            // Match SelectContent styling
            'w-[var(--radix-popover-trigger-width)] rounded-lg border border-solid border-input-border-default bg-input-bg-default p-0 shadow-md backdrop-blur-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2'
          )}
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Command shouldFilter={true}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              <CommandEmpty>{loading ? 'Loading...' : emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option.value)}
                    className="rounded-lg py-1.5 pl-2 pr-8 text-sm hover:bg-menutabs-fill-hover"
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {note ? (
        <div
          className={cn(
            'mt-1.5 !text-body-xs',
            state === 'error'
              ? 'text-text-caution'
              : state === 'success'
                ? 'text-text-success'
                : 'text-text-label'
          )}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
