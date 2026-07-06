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

import { Loader2, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProviderModelGroup } from '@/lib/providerModels';

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
  /** Reason to show inside the dropdown when disabled (e.g. "Enter API Key first"). */
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

/**
 * Model-type picker for providers that expose a `/models` endpoint
 * (Nebius, OrcaRouter). A full-width {@link Select} (matching the Eigent Cloud
 * model select) with a trailing rounded "Refresh" button to re-fetch the list.
 */
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
  const { t } = useTranslation();

  // Saved value not present in any group — surface it as a "Current" entry so
  // the select can still display and keep the existing selection.
  const orphanValue = useMemo(() => {
    if (!value) return null;
    const known = groups.some((g) => g.models.some((m) => m.id === value));
    return known ? null : value;
  }, [value, groups]);

  const hasAnyModels = groups.some((g) => g.models.length > 0);

  // The select is only usable once there is something to pick: an API key must
  // be set AND the model list must have been fetched (refreshed). A previously
  // saved value (orphan) still counts so the user can keep their selection.
  const selectDisabled = disabled || (!hasAnyModels && !orphanValue);

  const emptyMessage = loading
    ? t('setting.loading', { defaultValue: 'Loading...' })
    : disabled
      ? (disabledReason ??
        t('setting.enter-api-key-first', {
          defaultValue: 'Enter API Key first.',
        }))
      : t('setting.click-refresh-to-load-models', {
          defaultValue: 'Click refresh to load models.',
        });

  return (
    <div className="flex w-full flex-col">
      {title ? (
        <div className="mb-1.5 gap-1 text-body-sm font-bold text-ds-text-neutral-default-default flex items-center">
          {title}
        </div>
      ) : null}

      <div className="gap-2 flex w-full items-center">
        <Select
          value={value || undefined}
          onValueChange={onChange}
          disabled={selectDisabled}
        >
          <SelectTrigger
            wrapperClassName="min-w-0 flex-1"
            state={error ? 'error' : undefined}
            note={error ?? undefined}
            aria-label={`${providerName} model type`}
          >
            <SelectValue
              placeholder={triggerPlaceholder ?? 'Select model type'}
            />
          </SelectTrigger>
          <SelectContent>
            {!hasAnyModels && !orphanValue ? (
              <div className="px-3 py-6 text-xs text-ds-text-neutral-muted-default text-center">
                {emptyMessage}
              </div>
            ) : (
              <>
                {orphanValue ? (
                  <SelectGroup>
                    <SelectLabel>
                      {t('setting.current', { defaultValue: 'Current' })}
                    </SelectLabel>
                    <SelectItem value={orphanValue}>{orphanValue}</SelectItem>
                  </SelectGroup>
                ) : null}
                {groups.map((g) =>
                  g.models.length > 0 ? (
                    <SelectGroup key={g.provider}>
                      {g.provider ? (
                        <SelectLabel>{g.provider}</SelectLabel>
                      ) : null}
                      {g.models.map((m) => {
                        const [, modelName] = splitPrefix(m.id);
                        return (
                          <SelectItem key={m.id} value={m.id}>
                            {modelName}
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ) : null
                )}
              </>
            )}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="secondary"
          buttonRadius="full"
          onClick={onRefresh}
          disabled={disabled || loading}
          aria-label={`Refresh ${providerName} models`}
          className="text-body-sm shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="!h-4 !w-4" />
          )}
          {t('setting.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
    </div>
  );
}
