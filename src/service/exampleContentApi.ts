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

import {
  WORK_ROLE_KEYS,
  type ExampleContentCatalog,
  type ExampleContentCatalogCategory,
  type ExampleContentCatalogItem,
  type ExampleContentItemTranslation,
  type ExampleContentOptionsResponse,
  type ExampleRecommendationsRequest,
  type ExampleRecommendationsResponse,
  type ExampleSurface,
  type WorkRoleKey,
} from '@/types/exampleContent';

const CATALOG_MAXIMUM_AGE_MS = 24 * 60 * 60 * 1_000;
const CATALOG_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_EXAMPLE_CONTENT_CATALOG_URL =
  'https://cdn.eigent.ai/catalog/index.json';
const CDN_INDEX_MAXIMUM_BYTES = 64 * 1_024;
const CDN_OBJECT_MAXIMUM_BYTES = 10 * 1_024 * 1_024;
const CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const CDN_VERSION_PATTERN = /^v1-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROLE_KEYS = new Set<string>(WORK_ROLE_KEYS);

type FetchImplementation = typeof fetch;

interface CdnObjectDescriptor {
  bytes: number;
  sha256: string;
}

interface CdnCatalogIndex {
  providerKey: string;
  current: string;
  enabled: boolean;
  locales: string[];
  objects: Record<string, CdnObjectDescriptor>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (
  value: unknown,
  field: string,
  maximumLength: number,
  pattern?: RegExp
): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`Invalid example content field: ${field}`);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && character !== '\n' && character !== '\t') {
      throw new Error(`Invalid control character in: ${field}`);
    }
  }
  return value;
};

const nullableString = (
  value: unknown,
  field: string,
  maximumLength: number
): string | null => {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, maximumLength);
};

const booleanValue = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid example content field: ${field}`);
  }
  return value;
};

const integerValue = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Invalid example content field: ${field}`);
  }
  return value;
};

const stringArray = (
  value: unknown,
  field: string,
  minimumLength: number,
  maximumLength: number
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    !value.every((entry) => typeof entry === 'string') ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`Invalid example content field: ${field}`);
  }
  return value;
};

const parseJsonBytes = (
  bytes: Uint8Array,
  field: string,
  maximumBytes: number
): unknown => {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`Invalid example content object size: ${field}`);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`Invalid example content JSON: ${field}`);
  }
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error('Example content integrity verification is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const parseCdnCatalogIndex = (value: unknown): CdnCatalogIndex => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.minimumAdapterSchemaVersion !== 1 ||
    !isRecord(value.objects) ||
    Object.keys(value.objects).length === 0 ||
    Object.keys(value.objects).length > 100
  ) {
    throw new Error('Invalid or unsupported example content CDN index');
  }
  const locales = stringArray(value.locales, 'index.locales', 1, 20);
  if (!locales.every((locale) => LOCALE_PATTERN.test(locale))) {
    throw new Error('Invalid example content CDN locales');
  }
  if (!locales.includes('en')) {
    throw new Error('Example content CDN index must include the en locale');
  }
  const objects = Object.fromEntries(
    Object.entries(value.objects).map(([name, descriptor]) => {
      if (!isRecord(descriptor)) {
        throw new Error(`Invalid example content object descriptor: ${name}`);
      }
      return [
        name,
        {
          bytes: integerValue(
            descriptor.bytes,
            `index.objects.${name}.bytes`,
            1,
            CDN_OBJECT_MAXIMUM_BYTES
          ),
          sha256: requiredString(
            descriptor.sha256,
            `index.objects.${name}.sha256`,
            64,
            SHA256_PATTERN
          ),
        },
      ];
    })
  );
  return {
    providerKey: requiredString(
      value.providerKey,
      'index.providerKey',
      80,
      PROVIDER_KEY_PATTERN
    ),
    current: requiredString(
      value.current,
      'index.current',
      120,
      CDN_VERSION_PATTERN
    ),
    enabled: booleanValue(value.enabled, 'index.enabled'),
    locales: ['en', ...locales.filter((locale) => locale !== 'en')],
    objects,
  };
};

const normalizeOptionalTransportString = (value: unknown): unknown =>
  value === '' || value === undefined ? null : value;

const normalizeCdnLocaleCatalog = (
  catalogValue: unknown,
  categoriesValue: unknown,
  locale: string,
  index: CdnCatalogIndex,
  loadedAt: number
): ExampleContentCatalog => {
  if (
    !isRecord(catalogValue) ||
    catalogValue.schemaVersion !== 1 ||
    catalogValue.providerKey !== index.providerKey ||
    catalogValue.providerVersion !== index.current ||
    catalogValue.locale !== locale ||
    !Array.isArray(catalogValue.items) ||
    !isRecord(categoriesValue) ||
    categoriesValue.schemaVersion !== 1 ||
    categoriesValue.providerKey !== index.providerKey ||
    categoriesValue.locale !== locale ||
    !Array.isArray(categoriesValue.categories)
  ) {
    throw new Error(`Invalid example content CDN locale objects: ${locale}`);
  }
  const categories = categoriesValue.categories.map((category) => {
    if (!isRecord(category)) {
      throw new Error(`Invalid example content CDN category: ${locale}`);
    }
    return {
      key: category.key,
      enabled: category.enabled,
      sort_order: category.sortOrder,
      translations: {
        [locale]: {
          label: category.label,
          description: normalizeOptionalTransportString(category.description),
        },
      },
    };
  });
  const items = catalogValue.items.map((item) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid example content CDN item: ${locale}`);
    }
    let automationDraft: Record<string, unknown> | null = null;
    if (item.automation !== undefined && item.automation !== null) {
      if (!isRecord(item.automation) || !isRecord(item.automation.draft)) {
        throw new Error(`Invalid example content automation draft: ${locale}`);
      }
      automationDraft = item.automation.draft;
    }
    return {
      id: item.id,
      enabled: item.enabled,
      surfaces: item.surfaces,
      role_keys: item.roleKeys,
      space_category_keys: item.spaceCategoryKeys,
      priority: item.priority,
      translations: {
        [locale]: {
          title: item.title,
          summary: item.summary,
          prompt: item.prompt,
          automation_name: normalizeOptionalTransportString(
            automationDraft?.name
          ),
          automation_description: normalizeOptionalTransportString(
            automationDraft?.description
          ),
        },
      },
      attribution: normalizeOptionalTransportString(item.attribution),
      learn_more_url: normalizeOptionalTransportString(item.learnMoreUrl),
      requirements: { connector_keys: item.requiresConnectors },
    };
  });
  return parseExampleContentCatalog(
    {
      schema_version: 1,
      provider_key: index.providerKey,
      provider_version: index.current,
      enabled: catalogValue.enabled,
      space_categories: categories,
      items,
    },
    loadedAt
  );
};

const categoryContract = (category: ExampleContentCatalogCategory) =>
  JSON.stringify({
    key: category.key,
    enabled: category.enabled,
    sortOrder: category.sortOrder,
  });

const itemContract = (item: ExampleContentCatalogItem) =>
  JSON.stringify({
    id: item.id,
    enabled: item.enabled,
    surfaces: item.surfaces,
    roleKeys: item.roleKeys,
    spaceCategoryKeys: item.spaceCategoryKeys,
    priority: item.priority,
    attribution: item.attribution,
    requirements: item.requirements,
  });

const mergeCdnLocaleCatalogs = (
  catalogs: ExampleContentCatalog[],
  index: CdnCatalogIndex
): ExampleContentCatalog => {
  const [first, ...remaining] = catalogs;
  const categories = new Map(
    first.spaceCategories.map((category) => [
      category.key,
      { ...category, translations: { ...category.translations } },
    ])
  );
  const items = new Map(
    first.items.map((item) => [
      item.id,
      { ...item, translations: { ...item.translations } },
    ])
  );
  for (const catalog of remaining) {
    if (
      catalog.providerKey !== first.providerKey ||
      catalog.providerVersion !== first.providerVersion ||
      catalog.enabled !== first.enabled ||
      catalog.spaceCategories.length !== categories.size ||
      catalog.items.length !== items.size
    ) {
      throw new Error('Example content CDN locales have different contracts');
    }
    for (const category of catalog.spaceCategories) {
      const target = categories.get(category.key);
      if (
        target === undefined ||
        categoryContract(target) !== categoryContract(category)
      ) {
        throw new Error('Example content CDN categories differ by locale');
      }
      Object.assign(target.translations, category.translations);
    }
    for (const item of catalog.items) {
      const target = items.get(item.id);
      if (target === undefined || itemContract(target) !== itemContract(item)) {
        throw new Error('Example content CDN items differ by locale');
      }
      Object.assign(target.translations, item.translations);
    }
  }
  return {
    ...first,
    enabled: index.enabled && first.enabled,
    spaceCategories: [...categories.values()],
    items: [...items.values()],
  };
};

const validateCdnRegistry = (
  value: unknown,
  index: CdnCatalogIndex,
  catalog: ExampleContentCatalog
) => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.providerKey !== index.providerKey
  ) {
    throw new Error('Invalid example content CDN registry');
  }
  const itemIds = stringArray(value.itemIds, 'registry.itemIds', 0, 5_000);
  const categoryKeys = stringArray(
    value.categoryKeys,
    'registry.categoryKeys',
    0,
    500
  );
  const registeredItemIds = new Set(itemIds);
  const registeredCategoryKeys = new Set(categoryKeys);
  if (
    !itemIds.every((id) => ITEM_ID_PATTERN.test(id)) ||
    !categoryKeys.every((key) => CATEGORY_KEY_PATTERN.test(key)) ||
    catalog.items.some((item) => !registeredItemIds.has(item.id)) ||
    catalog.spaceCategories.some(
      (category) => !registeredCategoryKeys.has(category.key)
    )
  ) {
    throw new Error('Example content CDN registry is inconsistent');
  }
};

const translationsRecord = <T>(
  value: unknown,
  field: string,
  parse: (translation: unknown, locale: string) => T
): Record<string, T> => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error(`Invalid example content field: ${field}`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([locale, translation]) => {
      if (!LOCALE_PATTERN.test(locale)) {
        throw new Error(`Invalid example content locale: ${locale}`);
      }
      return [locale, parse(translation, locale)];
    })
  );
};

const parseCategory = (value: unknown): ExampleContentCatalogCategory => {
  if (!isRecord(value)) throw new Error('Invalid example content category');
  return {
    key: requiredString(value.key, 'category.key', 50, CATEGORY_KEY_PATTERN),
    enabled:
      value.enabled === undefined
        ? true
        : booleanValue(value.enabled, 'category.enabled'),
    sortOrder: integerValue(
      value.sort_order ?? 0,
      'category.sort_order',
      -10_000,
      10_000
    ),
    translations: translationsRecord(
      value.translations,
      'category.translations',
      (translation, locale) => {
        if (!isRecord(translation)) {
          throw new Error(`Invalid category translation: ${locale}`);
        }
        return {
          label: requiredString(
            translation.label,
            `category.translations.${locale}.label`,
            80
          ),
          description: nullableString(
            translation.description,
            `category.translations.${locale}.description`,
            240
          ),
        };
      }
    ),
  };
};

const parseItem = (value: unknown): ExampleContentCatalogItem => {
  if (!isRecord(value)) throw new Error('Invalid example content item');
  const surfaces = stringArray(value.surfaces, 'item.surfaces', 1, 2);
  if (
    !surfaces.every(
      (surface) => surface === 'workspace' || surface === 'automation'
    )
  ) {
    throw new Error('Invalid example content surface');
  }
  const roleKeys = stringArray(value.role_keys, 'item.role_keys', 1, 21);
  if (
    (roleKeys.includes('*') &&
      (roleKeys.length !== 1 || roleKeys[0] !== '*')) ||
    (!roleKeys.includes('*') && !roleKeys.every((key) => ROLE_KEYS.has(key)))
  ) {
    throw new Error('Invalid example content role keys');
  }
  const categoryKeys = stringArray(
    value.space_category_keys,
    'item.space_category_keys',
    1,
    51
  );
  if (
    (categoryKeys.includes('*') &&
      (categoryKeys.length !== 1 || categoryKeys[0] !== '*')) ||
    (!categoryKeys.includes('*') &&
      !categoryKeys.every((key) => CATEGORY_KEY_PATTERN.test(key)))
  ) {
    throw new Error('Invalid example content category keys');
  }
  const requirements = value.requirements ?? { connector_keys: [] };
  if (!isRecord(requirements)) {
    throw new Error('Invalid example content requirements');
  }
  const connectorKeys = stringArray(
    requirements.connector_keys ?? [],
    'item.requirements.connector_keys',
    0,
    20
  );
  if (!connectorKeys.every((key) => CATEGORY_KEY_PATTERN.test(key))) {
    throw new Error('Invalid example content connector key');
  }
  const learnMoreUrl = nullableString(
    value.learn_more_url,
    'item.learn_more_url',
    2_048
  );
  if (learnMoreUrl !== null) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(learnMoreUrl);
    } catch {
      throw new Error('Invalid example content learn more URL');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Invalid example content learn more URL');
    }
  }
  return {
    id: requiredString(value.id, 'item.id', 120, ITEM_ID_PATTERN),
    enabled:
      value.enabled === undefined
        ? true
        : booleanValue(value.enabled, 'item.enabled'),
    surfaces: surfaces as ExampleSurface[],
    roleKeys: roleKeys as Array<WorkRoleKey | '*'>,
    spaceCategoryKeys: categoryKeys,
    priority: integerValue(
      value.priority ?? 0,
      'item.priority',
      -10_000,
      10_000
    ),
    translations: translationsRecord(
      value.translations,
      'item.translations',
      (translation, locale): ExampleContentItemTranslation => {
        if (!isRecord(translation)) {
          throw new Error(`Invalid item translation: ${locale}`);
        }
        return {
          title: requiredString(
            translation.title,
            `item.translations.${locale}.title`,
            120
          ),
          summary: requiredString(
            translation.summary,
            `item.translations.${locale}.summary`,
            320
          ),
          prompt: requiredString(
            translation.prompt,
            `item.translations.${locale}.prompt`,
            8_000
          ),
          automationName: nullableString(
            translation.automation_name,
            `item.translations.${locale}.automation_name`,
            120
          ),
          automationDescription: nullableString(
            translation.automation_description,
            `item.translations.${locale}.automation_description`,
            500
          ),
        };
      }
    ),
    attribution: nullableString(value.attribution, 'item.attribution', 160),
    learnMoreUrl,
    requirements: { connectorKeys },
  };
};

export function parseExampleContentCatalog(
  value: unknown,
  loadedAt = Date.now()
): ExampleContentCatalog {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.space_categories) ||
    !Array.isArray(value.items) ||
    value.space_categories.length > 500 ||
    value.items.length > 5_000
  ) {
    throw new Error('Invalid or unsupported example content catalog');
  }
  const spaceCategories = value.space_categories.map(parseCategory);
  const items = value.items.map(parseItem);
  const categoryKeys = spaceCategories.map((category) => category.key);
  const itemIds = items.map((item) => item.id);
  if (new Set(categoryKeys).size !== categoryKeys.length) {
    throw new Error('Duplicate example content category key');
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error('Duplicate example content item ID');
  }
  const enabledCategoryKeys = new Set(
    spaceCategories
      .filter((category) => category.enabled)
      .map((category) => category.key)
  );
  for (const item of items) {
    if (
      item.spaceCategoryKeys[0] !== '*' &&
      item.spaceCategoryKeys.some((key) => !enabledCategoryKeys.has(key))
    ) {
      throw new Error(`Example ${item.id} references an unavailable category`);
    }
  }
  return {
    schemaVersion: 1,
    providerKey: requiredString(
      value.provider_key,
      'provider_key',
      80,
      PROVIDER_KEY_PATTERN
    ),
    providerVersion: requiredString(
      value.provider_version,
      'provider_version',
      120
    ),
    enabled:
      value.enabled === undefined
        ? true
        : booleanValue(value.enabled, 'enabled'),
    spaceCategories,
    items,
    loadedAt,
  };
}

export interface ExampleContentProvider {
  readonly providerKey: string;
  loadCatalog(signal?: AbortSignal): Promise<ExampleContentCatalog>;
}

const withRequestDeadline = async <T>(
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  request: (requestSignal: AbortSignal) => Promise<T>
): Promise<T> => {
  const requestController = new AbortController();
  let timedOut = false;
  const abortRequest = () => requestController.abort(signal?.reason);
  const aborted = new Promise<never>((_, reject) => {
    requestController.signal.addEventListener(
      'abort',
      () => {
        let error = new Error('Example content catalog request was cancelled');
        if (timedOut) {
          error = new Error('Example content catalog request timed out');
        } else if (signal?.reason instanceof Error) {
          error = signal.reason;
        }
        reject(error);
      },
      { once: true }
    );
  });
  if (signal?.aborted) {
    abortRequest();
  } else {
    signal?.addEventListener('abort', abortRequest, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, requestTimeoutMs);
  try {
    return await Promise.race([request(requestController.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
    if (!requestController.signal.aborted) requestController.abort();
  }
};

/** Public HTTP adapter for a provider-neutral single-document catalog. */
export class HttpExampleContentProvider implements ExampleContentProvider {
  constructor(
    readonly providerKey: string,
    private readonly catalogUrl: string,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis
    ),
    private readonly requestTimeoutMs = CATALOG_REQUEST_TIMEOUT_MS
  ) {
    const parsedUrl = new URL(catalogUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Example content catalog URL must use HTTP(S)');
    }
  }

  async loadCatalog(signal?: AbortSignal): Promise<ExampleContentCatalog> {
    return withRequestDeadline(
      signal,
      this.requestTimeoutMs,
      async (requestSignal) => {
        const response = await this.fetchImplementation(this.catalogUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          signal: requestSignal,
        });
        if (!response.ok) {
          throw new Error(
            `Example content catalog request failed (${response.status})`
          );
        }
        const catalog = parseExampleContentCatalog(await response.json());
        if (catalog.providerKey !== this.providerKey) {
          throw new Error(
            'Example content provider key does not match the configured source'
          );
        }
        return catalog;
      }
    );
  }
}

/** Default adapter for the website-authored, versioned public CDN catalog. */
export class CdnExampleContentProvider implements ExampleContentProvider {
  constructor(
    readonly providerKey: string,
    private readonly catalogIndexUrl: string,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(
      globalThis
    ),
    private readonly requestTimeoutMs = CATALOG_REQUEST_TIMEOUT_MS
  ) {
    const parsedUrl = new URL(catalogIndexUrl);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (
      parsedUrl.protocol !== 'https:' &&
      !(parsedUrl.protocol === 'http:' && loopbackHosts.has(parsedUrl.hostname))
    ) {
      throw new Error(
        'Example content CDN URL must use HTTPS or loopback HTTP'
      );
    }
  }

  private async fetchBytes(
    url: string,
    signal: AbortSignal,
    field: string,
    maximumBytes: number
  ): Promise<Uint8Array> {
    const response = await this.fetchImplementation(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Example content catalog request failed for ${field} (${response.status})`
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
      throw new Error(`Invalid example content object size: ${field}`);
    }
    return bytes;
  }

  private async fetchVersionedObject(
    index: CdnCatalogIndex,
    name: string,
    signal: AbortSignal
  ): Promise<unknown> {
    const descriptor = index.objects[name];
    if (descriptor === undefined) {
      throw new Error(`Missing example content CDN object: ${name}`);
    }
    const baseUrl = new URL('./', this.catalogIndexUrl);
    const objectUrl = new URL(`v/${index.current}/${name}`, baseUrl).toString();
    const bytes = await this.fetchBytes(
      objectUrl,
      signal,
      name,
      CDN_OBJECT_MAXIMUM_BYTES
    );
    if (bytes.byteLength !== descriptor.bytes) {
      throw new Error(`Example content CDN object size mismatch: ${name}`);
    }
    if ((await sha256Hex(bytes)) !== descriptor.sha256) {
      throw new Error(`Example content CDN object checksum mismatch: ${name}`);
    }
    return parseJsonBytes(bytes, name, CDN_OBJECT_MAXIMUM_BYTES);
  }

  async loadCatalog(signal?: AbortSignal): Promise<ExampleContentCatalog> {
    return withRequestDeadline(
      signal,
      this.requestTimeoutMs,
      async (requestSignal) => {
        const indexBytes = await this.fetchBytes(
          this.catalogIndexUrl,
          requestSignal,
          'index.json',
          CDN_INDEX_MAXIMUM_BYTES
        );
        const index = parseCdnCatalogIndex(
          parseJsonBytes(indexBytes, 'index.json', CDN_INDEX_MAXIMUM_BYTES)
        );
        if (index.providerKey !== this.providerKey) {
          throw new Error(
            'Example content provider key does not match the configured source'
          );
        }
        const loadedAt = Date.now();
        if (!index.enabled) {
          return {
            schemaVersion: 1,
            providerKey: index.providerKey,
            providerVersion: index.current,
            enabled: false,
            spaceCategories: [],
            items: [],
            loadedAt,
          };
        }
        const [localeObjects, registry] = await Promise.all([
          Promise.all(
            index.locales.map(async (locale) => {
              const [catalog, categories] = await Promise.all([
                this.fetchVersionedObject(
                  index,
                  `catalog.${locale}.json`,
                  requestSignal
                ),
                this.fetchVersionedObject(
                  index,
                  `categories.${locale}.json`,
                  requestSignal
                ),
              ]);
              return normalizeCdnLocaleCatalog(
                catalog,
                categories,
                locale,
                index,
                loadedAt
              );
            })
          ),
          this.fetchVersionedObject(index, 'registry.json', requestSignal),
        ]);
        const catalog = mergeCdnLocaleCatalogs(localeObjects, index);
        validateCdnRegistry(registry, index, catalog);
        return catalog;
      }
    );
  }
}

export function getDefaultExampleContentCatalogUrl(
  value: unknown = import.meta.env.VITE_EXAMPLE_CONTENT_CATALOG_URL
): string | null {
  if (value === undefined || value === null) {
    return DEFAULT_EXAMPLE_CONTENT_CATALOG_URL;
  }
  if (typeof value !== 'string') return null;
  return value.trim().length > 0
    ? value.trim()
    : DEFAULT_EXAMPLE_CONTENT_CATALOG_URL;
}

export function createDefaultExampleContentProvider(
  catalogUrl = getDefaultExampleContentCatalogUrl()
): ExampleContentProvider {
  if (catalogUrl === null) {
    throw new Error('VITE_EXAMPLE_CONTENT_CATALOG_URL is not configured');
  }
  return new CdnExampleContentProvider('eigent-default', catalogUrl);
}

export async function fetchExampleContentCatalog(
  signal?: AbortSignal
): Promise<ExampleContentCatalog> {
  return createDefaultExampleContentProvider().loadCatalog(signal);
}

const resolveTranslation = <T>(
  translations: Record<string, T>,
  locale: string
): [string, T] => {
  const locales = new Map(
    Object.keys(translations).map((key) => [key.toLocaleLowerCase(), key])
  );
  const candidates = [locale, locale.split('-', 1)[0], 'en-US', 'en'];
  for (const candidate of candidates) {
    const resolved = locales.get(candidate.toLocaleLowerCase());
    if (resolved !== undefined) return [resolved, translations[resolved]];
  }
  const fallback = Object.keys(translations).sort()[0];
  return [fallback, translations[fallback]];
};

const contentRevision = (catalog: ExampleContentCatalog) =>
  `${catalog.providerKey}:${catalog.providerVersion}`;

const expiresAt = (catalog: ExampleContentCatalog) =>
  catalog.enabled
    ? new Date(catalog.loadedAt + CATALOG_MAXIMUM_AGE_MS).toISOString()
    : null;

export function resolveExampleContentOptions(
  catalog: ExampleContentCatalog,
  locale: string
): ExampleContentOptionsResponse {
  const status = catalog.enabled ? 'ready' : 'disabled';
  return {
    schemaVersion: 1,
    contentRevision: contentRevision(catalog),
    status,
    delivery: catalog.enabled ? 'live' : 'none',
    expiresAt: expiresAt(catalog),
    spaceCategories: catalog.enabled
      ? catalog.spaceCategories
          .filter((category) => category.enabled)
          .map((category) => {
            const [resolvedLocale, translation] = resolveTranslation(
              category.translations,
              locale
            );
            return {
              key: category.key,
              label: translation.label,
              description: translation.description,
              sortOrder: category.sortOrder,
              resolvedLocale,
            };
          })
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder ||
              left.label.localeCompare(right.label) ||
              left.key.localeCompare(right.key)
          )
      : [],
  };
}

const matchingTier = (
  item: ExampleContentCatalogItem,
  roleKey: WorkRoleKey | null | undefined,
  categoryKey: string | null | undefined
): number | null => {
  const wildcardRole = item.roleKeys.length === 1 && item.roleKeys[0] === '*';
  const wildcardCategory =
    item.spaceCategoryKeys.length === 1 && item.spaceCategoryKeys[0] === '*';
  const exactRole = roleKey != null && item.roleKeys.includes(roleKey);
  const exactCategory =
    categoryKey != null && item.spaceCategoryKeys.includes(categoryKey);
  if (exactRole && exactCategory) return 1;
  if (wildcardRole && exactCategory) return 2;
  if (exactRole && wildcardCategory) return 3;
  if (wildcardRole && wildcardCategory) return 4;
  return null;
};

const exampleReference = (catalog: ExampleContentCatalog, itemId: string) =>
  `example:${catalog.providerKey}:${itemId}`;

export function resolveExampleRecommendations(
  catalog: ExampleContentCatalog,
  request: ExampleRecommendationsRequest
): ExampleRecommendationsResponse {
  if (!catalog.enabled) {
    return {
      schemaVersion: 1,
      contentRevision: contentRevision(catalog),
      status: 'disabled',
      delivery: 'none',
      expiresAt: null,
      items: [],
    };
  }
  const limit = Math.min(12, Math.max(1, Math.floor(request.limit ?? 3)));
  const candidates = catalog.items
    .filter((item) => item.enabled && item.surfaces.includes(request.surface))
    .map((item) => ({
      item,
      tier: matchingTier(item, request.roleKey, request.spaceCategoryKey),
      reference: exampleReference(catalog, item.id),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { tier: number } =>
        candidate.tier !== null
    )
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        right.item.priority - left.item.priority ||
        left.reference.localeCompare(right.reference)
    );
  const seen = new Set<string>();
  const items = candidates.flatMap(({ item, reference }) => {
    if (seen.has(reference)) return [];
    seen.add(reference);
    const [resolvedLocale, translation] = resolveTranslation(
      item.translations,
      request.locale
    );
    const automationDefaults =
      translation.automationName !== null ||
      translation.automationDescription !== null
        ? {
            name: translation.automationName,
            description: translation.automationDescription,
          }
        : null;
    return [
      {
        exampleRef: reference,
        title: translation.title,
        summary: translation.summary,
        prompt: translation.prompt,
        resolvedLocale,
        attribution: item.attribution,
        learnMoreUrl: item.learnMoreUrl,
        automationDefaults,
        requirements: item.requirements,
      },
    ];
  });
  return {
    schemaVersion: 1,
    contentRevision: contentRevision(catalog),
    status: 'ready',
    delivery: 'live',
    expiresAt: expiresAt(catalog),
    items: items.slice(0, limit),
  };
}

export function isExampleContentExpired(
  value: { expiresAt: string | null },
  now = Date.now()
): boolean {
  return value.expiresAt !== null && Date.parse(value.expiresAt) <= now;
}
