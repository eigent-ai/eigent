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
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SpaceDiscoveryOption {
  value: string;
  label: string;
  source: string;
  availability: 'available' | 'requires_setup';
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
  readOnlyCatalog = false,
  query: remoteQuery,
  onQueryChange,
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
  readOnlyCatalog?: boolean;
  query?: string;
  onQueryChange?: (value: string) => void;
  hasMore?: boolean;
  loadMore?: () => void;
  loadingMore?: boolean;
}) {
  const { t } = useTranslation();
  const feedbackId = useId();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const search = remoteQuery ?? query;
  const filtered = catalog.items.filter((item) =>
    `${item.label} ${item.value}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  );
  const sourceLabel = (item: SpaceDiscoveryOption) =>
    item.source === 'materialized_bundle'
      ? t('layout.space-discovery-installed-source')
      : item.source === 'draft_bundle'
        ? t('layout.space-discovery-draft-source')
        : item.source === 'connector_catalog'
          ? t('layout.space-discovery-provider-source')
          : t('layout.space-discovery-model-source');
  const current = catalog.items.find(
    (item) => item.value === (selectedValue ?? value)
  );
  const status =
    catalog.status === 'loading'
      ? t('setting.loading')
      : catalog.error
        ? t('layout.space-discovery-error')
        : catalog.status !== 'idle' && !filtered.length
          ? t('layout.space-discovery-empty')
          : null;
  return (
    <div className="flex min-w-0 flex-col gap-ds-8">
      <Input
        autoFocus={autoFocus}
        title={title}
        aria-label={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        state={error ? 'error' : 'default'}
        note={error}
        aria-describedby={feedbackId}
      />
      <div id={feedbackId} className="flex min-w-0 flex-col gap-ds-4">
        {note ? (
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {note}
          </DsText>
        ) : null}
        {current && !readOnlyCatalog ? (
          <DsText as="p" role="meta" className="text-ds-ink-muted-default">
            {sourceLabel(current)}
            {current.availability === 'requires_setup'
              ? ` · ${t('layout.space-discovery-setup')}`
              : ''}
          </DsText>
        ) : value &&
          !readOnlyCatalog &&
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
      <div className="flex flex-wrap gap-ds-control-gap">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t('layout.space-discovery-browse')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={catalog.status === 'loading'}
          onClick={catalog.retry}
        >
          {t(catalog.error ? 'layout.retry' : 'setting.refresh')}
        </Button>
      </div>
      {expanded ? (
        <div className="flex min-w-0 flex-col gap-ds-8">
          <Input
            size="sm"
            aria-label={`${t('layout.search')} ${title}`}
            placeholder={t('layout.search')}
            value={search}
            onChange={(event) => {
              setQuery(event.target.value);
              onQueryChange?.(event.target.value);
            }}
          />
          {readOnlyCatalog ? (
            <>
              <DsText as="p" role="meta" className="text-ds-ink-muted-default">
                {t('layout.space-discovery-model-gap')}
              </DsText>
              <ul className="m-0 flex list-none flex-col gap-ds-8 p-0">
                {filtered.map((item) => (
                  <li key={item.value} className="min-w-0 break-words">
                    <DsText as="p" role="base">
                      {item.label}
                    </DsText>
                    <DsText
                      as="p"
                      role="meta"
                      className="text-ds-ink-muted-default"
                    >
                      {sourceLabel(item)}
                    </DsText>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Select
              value=""
              onValueChange={(selected) => {
                const candidate = catalog.items.find(
                  (item) => item.value === selected
                );
                if (candidate)
                  onSelect ? onSelect(candidate) : onChange(candidate.value);
              }}
              disabled={!filtered.length}
            >
              <SelectTrigger
                size="sm"
                wrapperClassName="w-full"
                aria-label={`${t('layout.select')} ${title}`}
              >
                <SelectValue placeholder={t('layout.select')} />
              </SelectTrigger>
              <SelectContent fitTrigger>
                <>
                  {filtered.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      textValue={item.label}
                    >
                      <span className="break-words whitespace-normal">
                        {item.label} · {sourceLabel(item)}
                        {item.availability === 'requires_setup'
                          ? ` · ${t('layout.space-discovery-setup')}`
                          : ''}
                      </span>
                    </SelectItem>
                  ))}
                </>
              </SelectContent>
            </Select>
          )}
          {hasMore && loadMore ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {t('layout.space-discovery-load-more')}
            </Button>
          ) : null}
        </div>
      ) : null}
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
