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

import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ProviderModelGroup } from '@/lib/providerModels';
import { cn } from '@/lib/utils';

type Props = {
  /** Stable id used for "selected" comparison and aria-label scoping. */
  providerName: string;
  /** Localized field title shown above the trigger (e.g. "Model Type Setting"). */
  title: string;
  /** Currently saved model id. May be empty or a value not in `groups`. */
  value: string;
  onChange: (value: string) => void;
  groups: ProviderModelGroup[];
  loading: boolean;
  error: string | null;
  /** Disable everything when the user hasn't filled in an API key yet. */
  disabled: boolean;
  /** Reason to show inside the popover when disabled (e.g. "Enter API Key first"). */
  disabledReason?: string;
  onRefresh: () => void;
  triggerPlaceholder?: string;
};

/** Split `anthropic/claude-opus-4.6` into `["anthropic", "claude-opus-4.6"]`. */
function splitPrefix(id: string): [string, string] {
  const idx = id.indexOf('/');
  if (idx <= 0) return ['', id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

export function ProviderModelCombobox({
  providerName,
  title,
  value,
  onChange,
  groups,
  loading,
  error,
  disabled,
  disabledReason,
  onRefresh,
  triggerPlaceholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Default the active left-column entry to the provider of the saved value,
  // falling back to the first provider with at least one model.
  const initialActiveProvider = useMemo(() => {
    if (value) {
      const [prefix] = splitPrefix(value);
      if (prefix && groups.some((g) => g.provider === prefix)) return prefix;
    }
    const first = groups.find((g) => g.models.length > 0);
    return first?.provider ?? '';
  }, [value, groups]);

  const [activeProvider, setActiveProvider] = useState<string>(
    initialActiveProvider
  );

  // Keep activeProvider sane if `groups` changes (e.g. after a refresh).
  useEffect(() => {
    if (!activeProvider && initialActiveProvider) {
      setActiveProvider(initialActiveProvider);
    } else if (
      activeProvider &&
      groups.length > 0 &&
      !groups.some((g) => g.provider === activeProvider)
    ) {
      setActiveProvider(initialActiveProvider);
    }
  }, [groups, activeProvider, initialActiveProvider]);

  // Saved value not present in any group — surface a one-row "Current" section.
  const orphanValue = useMemo(() => {
    if (!value) return null;
    const known = groups.some((g) => g.models.some((m) => m.id === value));
    return known ? null : value;
  }, [value, groups]);

  // Models for the right column: active provider's models filtered by query.
  const activeModels = useMemo(() => {
    const group = groups.find((g) => g.provider === activeProvider);
    if (!group) return [];
    const q = query.trim().toLowerCase();
    if (!q) return group.models;
    return group.models.filter((m) => m.id.toLowerCase().includes(q));
  }, [groups, activeProvider, query]);

  const hasAnyModels = groups.some((g) => g.models.length > 0);

  return (
    <div className="flex w-full flex-col">
      {title ? (
        <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
          {title}
        </div>
      ) : null}

      <div className="flex w-full items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-label={`${providerName} model type`}
              disabled={disabled}
              className={cn(
                'flex h-10 w-full items-center justify-between rounded-md border px-3 text-body-sm transition-colors',
                'border-input-border-default bg-input-bg-default text-text-heading',
                'hover:border-input-border-hover focus:border-input-border-focus focus:outline-none',
                disabled && 'cursor-not-allowed opacity-50',
                error && 'border-input-border-cuation'
              )}
            >
              <span
                className={cn(
                  'truncate text-left',
                  !value && 'text-input-label-default'
                )}
              >
                {value || triggerPlaceholder || 'Select model'}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 flex-shrink-0 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search model..."
                value={query}
                onValueChange={setQuery}
              />

              {!hasAnyModels && !orphanValue ? (
                <div className="px-3 py-6 text-center text-xs text-text-label">
                  {loading
                    ? 'Loading...'
                    : disabled
                      ? (disabledReason ?? 'Enter API Key first.')
                      : 'Click the refresh button to load models.'}
                </div>
              ) : (
                <div className="flex max-h-80">
                  {/* Left column: provider list */}
                  <div className="w-[120px] flex-shrink-0 overflow-y-auto border-r border-border-secondary py-1">
                    {orphanValue ? (
                      <button
                        type="button"
                        onClick={() => setActiveProvider('__orphan__')}
                        className={cn(
                          'flex w-full items-center px-3 py-1.5 text-left text-xs text-text-label transition-colors',
                          activeProvider === '__orphan__'
                            ? 'bg-button-transparent-fill-hover text-text-heading'
                            : 'hover:bg-button-transparent-fill-hover'
                        )}
                      >
                        Current
                      </button>
                    ) : null}
                    {groups.map((g) => (
                      <button
                        key={g.provider}
                        type="button"
                        onClick={() => setActiveProvider(g.provider)}
                        className={cn(
                          'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors',
                          activeProvider === g.provider
                            ? 'bg-button-transparent-fill-hover text-text-heading'
                            : 'text-text-label hover:bg-button-transparent-fill-hover'
                        )}
                      >
                        <span className="truncate">{g.provider}</span>
                        <span className="ml-2 flex-shrink-0 text-text-label opacity-60">
                          {g.models.length}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Right column: models for active provider */}
                  <CommandList className="max-h-80 flex-1">
                    {activeProvider === '__orphan__' && orphanValue ? (
                      <CommandItem
                        value={orphanValue}
                        onSelect={() => {
                          onChange(orphanValue);
                          setOpen(false);
                        }}
                      >
                        <span className="truncate">{orphanValue}</span>
                      </CommandItem>
                    ) : activeModels.length > 0 ? (
                      activeModels.map((m) => {
                        const [, modelName] = splitPrefix(m.id);
                        return (
                          <CommandItem
                            key={m.id}
                            value={m.id}
                            onSelect={() => {
                              onChange(m.id);
                              setOpen(false);
                            }}
                            className={cn(
                              value === m.id &&
                                'bg-button-transparent-fill-hover'
                            )}
                          >
                            <span className="truncate">{modelName}</span>
                          </CommandItem>
                        );
                      })
                    ) : (
                      <CommandEmpty>
                        {query.trim() ? 'No matches.' : 'No models.'}
                      </CommandEmpty>
                    )}
                  </CommandList>
                </div>
              )}
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={disabled || loading}
          aria-label={`Refresh ${providerName} models`}
          className="flex-shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error ? (
        <div className="text-text-cuation mt-1.5 text-xs">{error}</div>
      ) : null}
    </div>
  );
}
