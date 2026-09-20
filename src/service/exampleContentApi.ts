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
const CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const ROLE_KEYS = new Set<string>(WORK_ROLE_KEYS);

type FetchImplementation = typeof fetch;

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

/** Public HTTP adapter used for the default website-authored S3/CDN catalog. */
export class HttpExampleContentProvider implements ExampleContentProvider {
  constructor(
    readonly providerKey: string,
    private readonly catalogUrl: string,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {
    const parsedUrl = new URL(catalogUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Example content catalog URL must use HTTP(S)');
    }
  }

  async loadCatalog(signal?: AbortSignal): Promise<ExampleContentCatalog> {
    const response = await this.fetchImplementation(this.catalogUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal,
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
}

export function getDefaultExampleContentCatalogUrl(
  value: unknown = import.meta.env.VITE_EXAMPLE_CONTENT_CATALOG_URL
): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function createDefaultExampleContentProvider(
  catalogUrl = getDefaultExampleContentCatalogUrl()
): ExampleContentProvider {
  if (catalogUrl === null) {
    throw new Error('VITE_EXAMPLE_CONTENT_CATALOG_URL is not configured');
  }
  return new HttpExampleContentProvider('eigent-default', catalogUrl);
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
