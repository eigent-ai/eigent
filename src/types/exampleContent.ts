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

export const WORK_ROLE_KEYS = [
  'product-management',
  'engineering',
  'human-resources',
  'finance',
  'marketing',
  'sales',
  'operations',
  'data-science',
  'design',
  'legal',
  'scientist',
  'student',
  'founder',
  'healthcare',
  'writer',
  'educator',
  'consultant',
  'researcher',
  'software-engineer',
  'others',
] as const;

export type WorkRoleKey = (typeof WORK_ROLE_KEYS)[number];
/** Opaque content-owned slug. Desktop code must not enumerate category values. */
export type SpaceCategoryKey = string;
export type ExampleSurface = 'workspace' | 'automation';
export type ExampleContentStatus = 'ready' | 'disabled' | 'unavailable';
export type ExampleContentDelivery = 'live' | 'cache' | 'none';

export interface ExampleCategoryOption {
  key: SpaceCategoryKey;
  label: string;
  description: string | null;
  sortOrder: number;
  resolvedLocale: string;
}

export interface ExampleRequirements {
  connectorKeys: string[];
}

export interface ExampleAutomationDefaults {
  name: string | null;
  description: string | null;
}

export interface ExampleContentItem {
  exampleRef: string;
  title: string;
  summary: string;
  prompt: string;
  resolvedLocale: string;
  attribution: string | null;
  learnMoreUrl: string | null;
  automationDefaults: ExampleAutomationDefaults | null;
  requirements: ExampleRequirements;
}

interface ExampleContentEnvelope {
  schemaVersion: 1;
  contentRevision: string;
  status: ExampleContentStatus;
  delivery: ExampleContentDelivery;
  expiresAt: string | null;
}

export interface ExampleContentOptionsResponse extends ExampleContentEnvelope {
  spaceCategories: ExampleCategoryOption[];
}

export interface ExampleRecommendationsResponse extends ExampleContentEnvelope {
  items: ExampleContentItem[];
}

export interface ExampleRecommendationsRequest {
  surface: ExampleSurface;
  roleKey?: WorkRoleKey | null;
  spaceCategoryKey?: SpaceCategoryKey | null;
  locale: string;
  limit?: number;
}

export interface ExampleContentCategoryTranslation {
  label: string;
  description: string | null;
}

export interface ExampleContentCatalogCategory {
  key: SpaceCategoryKey;
  enabled: boolean;
  sortOrder: number;
  translations: Record<string, ExampleContentCategoryTranslation>;
}

export interface ExampleContentItemTranslation {
  title: string;
  summary: string;
  prompt: string;
  automationName: string | null;
  automationDescription: string | null;
}

export interface ExampleContentCatalogItem {
  id: string;
  enabled: boolean;
  surfaces: ExampleSurface[];
  roleKeys: Array<WorkRoleKey | '*'>;
  spaceCategoryKeys: Array<SpaceCategoryKey | '*'>;
  priority: number;
  translations: Record<string, ExampleContentItemTranslation>;
  attribution: string | null;
  learnMoreUrl: string | null;
  requirements: ExampleRequirements;
}

/** Validated snapshot of the provider-neutral catalog published to S3/CDN. */
export interface ExampleContentCatalog {
  schemaVersion: 1;
  providerKey: string;
  providerVersion: string;
  enabled: boolean;
  spaceCategories: ExampleContentCatalogCategory[];
  items: ExampleContentCatalogItem[];
  loadedAt: number;
}
