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

import type {
  ExampleCategoryOption,
  ExampleContentOptionsResponse,
  SpaceCategoryKey,
} from '@/types/exampleContent';

const MAX_REVISIONS_PER_SCOPE = 4;
const snapshots = new Map<string, Map<string, ExampleContentOptionsResponse>>();
const lastKnownLabels = new Map<
  string,
  Map<SpaceCategoryKey, ExampleCategoryOption & { contentRevision: string }>
>();

const scopeKey = (environment: string, account: string) =>
  `${environment}\u0000${account}`;

export function rememberExampleCategoryOptions(
  environment: string,
  account: string,
  response: ExampleContentOptionsResponse
): void {
  const scope = scopeKey(environment, account);
  const revisions = snapshots.get(scope) ?? new Map();
  revisions.delete(response.contentRevision);
  revisions.set(response.contentRevision, response);
  while (revisions.size > MAX_REVISIONS_PER_SCOPE) {
    const oldest = revisions.keys().next().value;
    if (oldest === undefined) break;
    revisions.delete(oldest);
  }
  snapshots.set(scope, revisions);

  const labels = lastKnownLabels.get(scope) ?? new Map();
  for (const category of response.spaceCategories) {
    labels.set(category.key, {
      ...category,
      contentRevision: response.contentRevision,
    });
  }
  lastKnownLabels.set(scope, labels);
}

export function getExampleCategoryOptionsSnapshot(
  environment: string,
  account: string,
  contentRevision: string
): ExampleContentOptionsResponse | null {
  return (
    snapshots.get(scopeKey(environment, account))?.get(contentRevision) ?? null
  );
}

export function getLastKnownExampleCategory(
  environment: string,
  account: string,
  categoryKey: SpaceCategoryKey
): (ExampleCategoryOption & { contentRevision: string }) | null {
  return (
    lastKnownLabels.get(scopeKey(environment, account))?.get(categoryKey) ??
    null
  );
}

export function clearExampleCategoryCache(
  environment?: string,
  account?: string
): void {
  if (environment === undefined || account === undefined) {
    snapshots.clear();
    lastKnownLabels.clear();
    return;
  }
  const scope = scopeKey(environment, account);
  snapshots.delete(scope);
  lastKnownLabels.delete(scope);
}
