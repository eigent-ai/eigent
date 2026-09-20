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
  HttpExampleContentProvider,
  isExampleContentExpired,
  parseExampleContentCatalog,
  resolveExampleContentOptions,
  resolveExampleRecommendations,
} from '@/service/exampleContentApi';
import { describe, expect, it, vi } from 'vitest';

const item = (
  id: string,
  roleKeys: string[],
  categoryKeys: string[],
  priority = 0
) => ({
  id,
  enabled: true,
  surfaces: ['workspace'],
  role_keys: roleKeys,
  space_category_keys: categoryKeys,
  priority,
  translations: {
    en: {
      title: id,
      summary: `${id} summary`,
      prompt: `${id} prompt`,
    },
  },
  requirements: { connector_keys: [] },
});

const rawCatalog = () => ({
  schema_version: 1,
  provider_key: 'eigent-default',
  provider_version: 'revision-1',
  enabled: true,
  space_categories: [
    {
      key: 'customer-success',
      enabled: true,
      sort_order: 10,
      translations: {
        en: { label: 'Customer success' },
        'fr-FR': { label: 'Réussite client' },
      },
    },
  ],
  items: [
    item('exact', ['engineering'], ['customer-success']),
    item('category', ['*'], ['customer-success']),
    item('role', ['engineering'], ['*']),
    item('fallback', ['*'], ['*']),
  ],
});

describe('example content S3 catalog', () => {
  it('validates content-defined categories and localizes their labels', () => {
    const catalog = parseExampleContentCatalog(rawCatalog(), 1_000);
    const options = resolveExampleContentOptions(catalog, 'fr-FR');

    expect(options.contentRevision).toBe('eigent-default:revision-1');
    expect(options.spaceCategories[0]).toEqual({
      key: 'customer-success',
      label: 'Réussite client',
      description: null,
      sortOrder: 10,
      resolvedLocale: 'fr-FR',
    });
  });

  it('orders exact, category, role, and wildcard matches', () => {
    const catalog = parseExampleContentCatalog(rawCatalog());
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      roleKey: 'engineering',
      spaceCategoryKey: 'customer-success',
      locale: 'en-US',
      limit: 4,
    });

    expect(result.items.map((entry) => entry.title)).toEqual([
      'exact',
      'category',
      'role',
      'fallback',
    ]);
    expect(result.items[0].exampleRef).toBe('example:eigent-default:exact');
  });

  it('uses only wildcard matches when preferences are unset', () => {
    const catalog = parseExampleContentCatalog(rawCatalog());
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      locale: 'en',
      limit: 4,
    });

    expect(result.items.map((entry) => entry.title)).toEqual(['fallback']);
  });

  it('treats a successfully disabled catalog as authoritative', () => {
    const catalog = parseExampleContentCatalog({
      ...rawCatalog(),
      enabled: false,
    });

    expect(resolveExampleContentOptions(catalog, 'en')).toMatchObject({
      status: 'disabled',
      spaceCategories: [],
    });
    expect(
      resolveExampleRecommendations(catalog, {
        surface: 'workspace',
        locale: 'en',
      })
    ).toMatchObject({ status: 'disabled', items: [] });
  });

  it('rejects duplicate IDs and references to disabled categories', () => {
    const duplicate = rawCatalog();
    duplicate.items.push(item('exact', ['*'], ['*']));
    expect(() => parseExampleContentCatalog(duplicate)).toThrow('Duplicate');

    const unavailableCategory = rawCatalog();
    unavailableCategory.space_categories[0].enabled = false;
    expect(() => parseExampleContentCatalog(unavailableCategory)).toThrow(
      'unavailable category'
    );
  });

  it('fetches the public catalog without credentials', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rawCatalog(),
    }) as unknown as typeof fetch;
    const provider = new HttpExampleContentProvider(
      'eigent-default',
      'https://cdn.example.com/example-content/catalog.json',
      fetchImplementation
    );

    await expect(provider.loadCatalog()).resolves.toMatchObject({
      providerKey: 'eigent-default',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://cdn.example.com/example-content/catalog.json',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: undefined,
      }
    );
  });

  it('rejects a catalog that does not belong to the configured provider', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...rawCatalog(), provider_key: 'other-provider' }),
    }) as unknown as typeof fetch;
    const provider = new HttpExampleContentProvider(
      'eigent-default',
      'https://cdn.example.com/example-content/catalog.json',
      fetchImplementation
    );

    await expect(provider.loadCatalog()).rejects.toThrow('provider key');
  });

  it('does not reuse a catalog after its maximum age', () => {
    const catalog = parseExampleContentCatalog(rawCatalog(), 1_000);
    const result = resolveExampleRecommendations(catalog, {
      surface: 'workspace',
      locale: 'en',
    });

    expect(isExampleContentExpired(result, 1_001)).toBe(false);
    expect(isExampleContentExpired(result, 1_000 + 24 * 60 * 60 * 1_000)).toBe(
      true
    );
  });
});
