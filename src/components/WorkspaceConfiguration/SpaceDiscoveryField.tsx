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
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';

export interface SpaceDiscoveryOption {
  value: string;
  label: string;
  source: string;
  availability: 'available' | 'requires_setup';
  disabled?: boolean;
  reason?: string;
}

export interface SpaceDiscoveryCatalog<
  T extends SpaceDiscoveryOption = SpaceDiscoveryOption,
> {
  items: T[];
  status: string;
  error: string | null;
  retry: () => void;
}

export function SpaceDiscoveryField<T extends SpaceDiscoveryOption>({
  title,
  value,
  selectedValue,
  autoFocus,
  onChange,
  onSelect,
  catalog,
  note,
  error,
  hasMore,
  loadMore,
  loadingMore,
}: {
  title: string;
  value: string;
  selectedValue?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSelect?: (candidate: T) => void;
  catalog: SpaceDiscoveryCatalog<T>;
  note?: string;
  error?: string;
  hasMore?: boolean;
  loadMore?: () => void;
  loadingMore?: boolean;
}) {
  const { t } = useTranslation();
  const feedbackId = useId();
  // Continue through empty intermediate pages too. A failed page stops until
  // Retry, while already loaded options remain usable in the same control.
  useEffect(() => {
    if (hasMore && !loadingMore && !catalog.error) loadMore?.();
  }, [hasMore, loadingMore, catalog.error, loadMore]);
  const sourceLabel = (item: SpaceDiscoveryOption) =>
    item.source === 'global_configuration'
      ? t('layout.space-discovery-global-source')
      : item.source === 'materialized_bundle'
        ? t('layout.space-discovery-installed-source')
        : item.source === 'draft_bundle'
          ? t('layout.space-discovery-draft-source')
          : item.source === 'connector_catalog'
            ? t('layout.space-discovery-provider-source')
            : item.source === 'custom_catalog'
              ? t('layout.space-discovery-custom-model-source')
              : item.source === 'local_catalog'
                ? t('layout.space-discovery-local-model-source')
                : item.source === 'user_default'
                  ? t('layout.space-discovery-inherited-model-source')
                  : t('layout.space-discovery-model-source');
  const availabilityLabel = (item: SpaceDiscoveryOption) => {
    if (item.reason === 'model_ambiguous')
      return t('layout.space-discovery-model-ambiguous');
    if (item.reason === 'model_unavailable')
      return t('layout.space-discovery-model-unavailable');
    if (item.reason === 'resource_duplicate')
      return t('layout.space-discovery-duplicate');
    if (item.reason === 'global_resource_disabled')
      return t('layout.space-discovery-resource-disabled');
    if (item.source === 'global_configuration')
      return t('layout.space-discovery-resource-invalid');
    return t('layout.space-discovery-setup');
  };
  const selection = value ? (selectedValue ?? value) : '';
  const current = catalog.items.find((item) => item.value === selection);
  const loading = catalog.status === 'loading' || loadingMore || hasMore;
  const status = catalog.error
    ? t(
        catalog.error === 'model_catalog_partial'
          ? 'layout.space-discovery-model-partial'
          : catalog.error === 'connector_catalog_disabled'
            ? 'layout.space-discovery-connectors-disabled'
            : 'layout.space-discovery-error'
      )
    : loading
      ? t('setting.loading')
      : catalog.status !== 'idle' && !catalog.items.length
        ? t('layout.space-discovery-empty')
        : null;
  return (
    <div className="flex min-w-0 flex-col gap-ds-8">
      <Select
        value={selection}
        onValueChange={(selected) => {
          const candidate = catalog.items.find(
            (item) => item.value === selected
          );
          if (candidate && !candidate.disabled)
            onSelect ? onSelect(candidate) : onChange(candidate.value);
        }}
        disabled={!catalog.items.length && !selection}
      >
        <SelectTrigger
          autoFocus={autoFocus}
          title={title}
          wrapperClassName="w-full min-w-0"
          aria-label={title}
          aria-describedby={feedbackId}
          aria-busy={Boolean(loading && !catalog.error)}
          state={error ? 'error' : undefined}
          note={error}
        >
          <SelectValue placeholder={t('layout.select')}>
            {selection ? (
              <span className="truncate" title={current?.label ?? value}>
                {current?.label ?? value}
              </span>
            ) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent fitTrigger>
          {selection && !current ? (
            <SelectItem value={selection} textValue={value} disabled>
              <span className="break-words whitespace-normal">{value}</span>
            </SelectItem>
          ) : null}
          {catalog.items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              textValue={item.label}
              disabled={item.disabled}
            >
              <span className="break-words whitespace-normal">
                {item.label} · {sourceLabel(item)}
                {item.disabled || item.availability === 'requires_setup'
                  ? ` · ${availabilityLabel(item)}`
                  : ''}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div id={feedbackId} className="flex min-w-0 flex-col gap-ds-4">
        {note ? (
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {note}
          </DsText>
        ) : null}
        {current ? (
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {sourceLabel(current)}
            {current.disabled || current.availability === 'requires_setup'
              ? ` · ${availabilityLabel(current)}`
              : ''}
          </DsText>
        ) : value &&
          catalog.status !== 'loading' &&
          catalog.status !== 'idle' ? (
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {t('layout.space-discovery-unknown')}
          </DsText>
        ) : null}
        <div aria-live="polite">
          {status ? (
            <DsText as="p" role="meta" className="text-ds-ink-muted-default">
              {status}
            </DsText>
          ) : null}
        </div>
      </div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={catalog.status === 'loading' || loadingMore}
          onClick={catalog.retry}
        >
          {t(catalog.error ? 'layout.retry' : 'setting.refresh')}
        </Button>
      </div>
    </div>
  );
}

/** Keep the editable serialized list, including unknown entries and an intentional empty list. */
export function SpaceAssignmentField({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const available = options.filter((option) => !values.includes(option));
  return (
    <div className="flex min-w-0 flex-col gap-ds-8">
      <Input
        title={title}
        aria-label={title}
        value={values.join(', ')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          )
        }
      />
      {available.length ? (
        <Select
          value=""
          onValueChange={(value) => onChange([...values, value])}
        >
          <SelectTrigger
            size="sm"
            wrapperClassName="w-full"
            aria-label={`${t('layout.select')} ${title}`}
          >
            <SelectValue placeholder={t('layout.select')} />
          </SelectTrigger>
          <SelectContent fitTrigger>
            {available.map((value) => (
              <SelectItem key={value} value={value}>
                <span className="break-words whitespace-normal">{value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
