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

import {
  isExampleContentExpired,
  parseExampleContentOptions,
  parseExampleRecommendations,
} from '@/service/exampleContentApi';
import { describe, expect, it } from 'vitest';

const envelope = {
  schema_version: 1,
  content_revision: 'revision-1',
  status: 'ready',
  delivery: 'live',
  expires_at: '2026-09-21T00:00:00Z',
};

describe('exampleContentApi runtime validation', () => {
  it('maps provider-neutral options without enumerating category keys', () => {
    const result = parseExampleContentOptions({
      ...envelope,
      space_categories: [
        {
          key: 'new-content-defined-category',
          label: 'A new category',
          description: null,
          sort_order: 12,
          resolved_locale: 'en',
        },
      ],
    });

    expect(result.spaceCategories[0]).toEqual({
      key: 'new-content-defined-category',
      label: 'A new category',
      description: null,
      sortOrder: 12,
      resolvedLocale: 'en',
    });
  });

  it('maps recommendations and optional Automation defaults', () => {
    const result = parseExampleRecommendations({
      ...envelope,
      items: [
        {
          example_ref: 'example_123',
          title: 'Weekly review',
          summary: 'Review the week.',
          prompt: 'Prepare a weekly review.',
          resolved_locale: 'en',
          attribution: null,
          learn_more_url: null,
          automation_defaults: {
            name: 'Weekly review',
            description: null,
          },
          requirements: { connector_keys: [] },
        },
      ],
    });

    expect(result.items[0].exampleRef).toBe('example_123');
    expect(result.items[0].automationDefaults?.name).toBe('Weekly review');
  });

  it('rejects content in disabled and unavailable envelopes', () => {
    expect(() =>
      parseExampleRecommendations({
        ...envelope,
        status: 'disabled',
        delivery: 'none',
        items: [
          {
            example_ref: 'example_123',
            title: 'Should not render',
            summary: 'Should not render.',
            prompt: 'Should not render.',
            resolved_locale: 'en',
            requirements: { connector_keys: [] },
          },
        ],
      })
    ).toThrow('Non-ready');
  });

  it('rejects unknown schema versions and malformed items', () => {
    expect(() =>
      parseExampleRecommendations({
        ...envelope,
        schema_version: 2,
        items: [],
      })
    ).toThrow('Unsupported');
    expect(() =>
      parseExampleRecommendations({
        ...envelope,
        items: [{ prompt: 'Incomplete' }],
      })
    ).toThrow('Invalid');
  });

  it('does not reuse content after its server-provided expiry', () => {
    expect(
      isExampleContentExpired(
        { expiresAt: '2026-09-21T00:00:00Z' },
        Date.parse('2026-09-21T00:00:01Z')
      )
    ).toBe(true);
    expect(
      isExampleContentExpired({ expiresAt: null }, Number.MAX_SAFE_INTEGER)
    ).toBe(false);
  });
});
