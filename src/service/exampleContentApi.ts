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

import { proxyFetchGet } from '@/api/http';
import type {
  ExampleCategoryOption,
  ExampleContentDelivery,
  ExampleContentItem,
  ExampleContentOptionsResponse,
  ExampleContentStatus,
  ExampleRecommendationsRequest,
  ExampleRecommendationsResponse,
} from '@/types/exampleContent';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (
  value: unknown,
  field: string,
  maximumLength: number
): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new Error(`Invalid example content field: ${field}`);
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

const statusValue = (value: unknown): ExampleContentStatus => {
  if (value === 'ready' || value === 'disabled' || value === 'unavailable')
    return value;
  throw new Error('Invalid example content status');
};

const deliveryValue = (value: unknown): ExampleContentDelivery => {
  if (
    value === 'live' ||
    value === 'cache' ||
    value === 'bundled' ||
    value === 'none'
  )
    return value;
  throw new Error('Invalid example content delivery');
};

const parseEnvelope = (value: Record<string, unknown>) => {
  if (value.schema_version !== 1)
    throw new Error('Unsupported example content schema');
  const expiresAt = nullableString(value.expires_at, 'expires_at', 100);
  if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('Invalid example content expiry');
  }
  return {
    schemaVersion: 1 as const,
    contentRevision: requiredString(
      value.content_revision,
      'content_revision',
      200
    ),
    status: statusValue(value.status),
    delivery: deliveryValue(value.delivery),
    expiresAt,
  };
};

const parseCategory = (value: unknown): ExampleCategoryOption => {
  if (!isRecord(value) || typeof value.sort_order !== 'number') {
    throw new Error('Invalid example category option');
  }
  return {
    key: requiredString(value.key, 'category.key', 50),
    label: requiredString(value.label, 'category.label', 80),
    description: nullableString(value.description, 'category.description', 240),
    sortOrder: value.sort_order,
    resolvedLocale: requiredString(
      value.resolved_locale,
      'category.resolved_locale',
      35
    ),
  };
};

const parseItem = (value: unknown): ExampleContentItem => {
  if (!isRecord(value) || !isRecord(value.requirements)) {
    throw new Error('Invalid example content item');
  }
  const connectorKeys = value.requirements.connector_keys;
  if (
    !Array.isArray(connectorKeys) ||
    !connectorKeys.every((key) => typeof key === 'string')
  ) {
    throw new Error('Invalid example content requirements');
  }
  let automationDefaults = null;
  if (
    value.automation_defaults !== null &&
    value.automation_defaults !== undefined
  ) {
    if (!isRecord(value.automation_defaults))
      throw new Error('Invalid Automation defaults');
    automationDefaults = {
      name: nullableString(
        value.automation_defaults.name,
        'automation_defaults.name',
        120
      ),
      description: nullableString(
        value.automation_defaults.description,
        'automation_defaults.description',
        500
      ),
    };
  }
  return {
    exampleRef: requiredString(value.example_ref, 'example_ref', 200),
    title: requiredString(value.title, 'title', 120),
    summary: requiredString(value.summary, 'summary', 320),
    prompt: requiredString(value.prompt, 'prompt', 8_000),
    resolvedLocale: requiredString(
      value.resolved_locale,
      'resolved_locale',
      35
    ),
    attribution: nullableString(value.attribution, 'attribution', 160),
    learnMoreUrl: nullableString(value.learn_more_url, 'learn_more_url', 2_048),
    automationDefaults,
    requirements: { connectorKeys: [...connectorKeys] },
  };
};

export function parseExampleContentOptions(
  value: unknown
): ExampleContentOptionsResponse {
  if (!isRecord(value) || !Array.isArray(value.space_categories)) {
    throw new Error('Invalid example content options response');
  }
  const envelope = parseEnvelope(value);
  const spaceCategories = value.space_categories.map(parseCategory);
  if (envelope.status !== 'ready' && spaceCategories.length > 0) {
    throw new Error('Non-ready example options cannot contain categories');
  }
  return { ...envelope, spaceCategories };
}

export function isExampleContentExpired(
  value: { expiresAt: string | null },
  now = Date.now()
): boolean {
  return value.expiresAt !== null && Date.parse(value.expiresAt) <= now;
}

export function parseExampleRecommendations(
  value: unknown
): ExampleRecommendationsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Invalid example recommendations response');
  }
  const envelope = parseEnvelope(value);
  const items = value.items.map(parseItem);
  if (envelope.status !== 'ready' && items.length > 0) {
    throw new Error('Non-ready example recommendations cannot contain items');
  }
  return { ...envelope, items };
}

export async function fetchExampleContentOptions(
  locale: string,
  signal?: AbortSignal
): Promise<ExampleContentOptionsResponse> {
  const response = await proxyFetchGet(
    '/api/v1/example-prompt-options',
    { locale },
    undefined,
    { signal }
  );
  return parseExampleContentOptions(response);
}

export async function fetchExampleRecommendations(
  request: ExampleRecommendationsRequest,
  signal?: AbortSignal
): Promise<ExampleRecommendationsResponse> {
  const response = await proxyFetchGet(
    '/api/v1/example-prompts',
    {
      surface: request.surface,
      role_key: request.roleKey || undefined,
      space_category_key: request.spaceCategoryKey || undefined,
      locale: request.locale,
      limit: request.limit ?? 3,
    },
    undefined,
    { signal }
  );
  return parseExampleRecommendations(response);
}
