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
  clearExampleCategoryCache,
  getExampleCategoryOptionsSnapshot,
  getLastKnownExampleCategory,
  rememberExampleCategoryOptions,
} from '@/lib/exampleCategoryCache';
import type { ExampleContentOptionsResponse } from '@/types/exampleContent';
import { beforeEach, describe, expect, it } from 'vitest';

const response = (
  revision: string,
  categories: ExampleContentOptionsResponse['spaceCategories']
): ExampleContentOptionsResponse => ({
  schemaVersion: 1,
  contentRevision: revision,
  status: 'ready',
  delivery: 'live',
  expiresAt: '2026-09-21T00:00:00Z',
  spaceCategories: categories,
});

describe('example category cache', () => {
  beforeEach(() => clearExampleCategoryCache());

  it('scopes snapshots by environment, account, and revision', () => {
    const first = response('r1', []);
    rememberExampleCategoryOptions('env-a', 'account-1', first);

    expect(getExampleCategoryOptionsSnapshot('env-a', 'account-1', 'r1')).toBe(
      first
    );
    expect(
      getExampleCategoryOptionsSnapshot('env-b', 'account-1', 'r1')
    ).toBeNull();
    expect(
      getExampleCategoryOptionsSnapshot('env-a', 'account-2', 'r1')
    ).toBeNull();
  });

  it('retains a last-known label after a later provider revision withdraws the category', () => {
    rememberExampleCategoryOptions(
      'env-a',
      'account-1',
      response('r1', [
        {
          key: 'customer-success',
          label: 'Customer success',
          description: null,
          sortOrder: 10,
          resolvedLocale: 'en',
        },
      ])
    );
    rememberExampleCategoryOptions('env-a', 'account-1', response('r2', []));

    expect(
      getLastKnownExampleCategory('env-a', 'account-1', 'customer-success')
    ).toMatchObject({ label: 'Customer success', contentRevision: 'r1' });
  });
});
