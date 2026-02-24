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

import { fetchPost } from '@/api/http';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Platforms where model names are arbitrary — show a plain text input instead
// of a suggestion dropdown.
const FREE_TEXT_PLATFORMS = new Set([
  'openrouter',
  'aws-bedrock',
  'openai-compatible-model',
  'azure',
  'ollama',
  'vllm',
  'sglang',
  'lmstudio',
]);

// Module-level cache so suggestions persist across component instances
// and don't re-fetch when navigating between tabs
const suggestionsCache: Record<string, ComboboxOption[]> = {};

interface ModelTypeComboboxProps {
  platform: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  title?: string;
}

export function ModelTypeCombobox({
  platform,
  value,
  onValueChange,
  placeholder,
  disabled,
  error,
  title,
}: ModelTypeComboboxProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  // Track which cache key we last fetched to avoid redundant fetches
  const fetchedKeyRef = useRef<string>('');

  const cacheKey = platform;

  useEffect(() => {
    // If we already have cached results for this key, use them
    if (suggestionsCache[cacheKey]) {
      setOptions(suggestionsCache[cacheKey]);
      return;
    }

    // If we already fetched (or are fetching) this key, skip
    if (fetchedKeyRef.current === cacheKey) {
      return;
    }

    // Don't fetch if platform is empty
    if (!platform) {
      return;
    }

    fetchedKeyRef.current = cacheKey;
    setLoading(true);

    fetchPost('/model/types', { platform })
      .then((res) => {
        if (res && res.model_types && Array.isArray(res.model_types)) {
          const opts: ComboboxOption[] = res.model_types.map(
            (type: string) => ({
              value: type,
              label: type,
            })
          );
          suggestionsCache[cacheKey] = opts;
          setOptions(opts);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch model type suggestions:', err);
        // Reset so the next render can retry
        fetchedKeyRef.current = '';
        setOptions([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [cacheKey]);

  if (FREE_TEXT_PLATFORMS.has(platform)) {
    return (
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        state={error ? 'error' : undefined}
        note={error}
        title={title}
        className="placeholder:text-text-body/40"
      />
    );
  }

  return (
    <Combobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchPlaceholder={t('setting.search-model-types')}
      emptyText={
        loading
          ? t('setting.loading-suggestions')
          : t('setting.no-model-types-found')
      }
      disabled={disabled}
      loading={loading}
      allowCustomValue={true}
      title={title}
      state={error ? 'error' : undefined}
      note={error}
    />
  );
}
