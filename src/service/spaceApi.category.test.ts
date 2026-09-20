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

import { toLocalSpace, type ServerSpace } from '@/service/spaceApi';
import { describe, expect, it } from 'vitest';

const serverSpace = (categoryKey?: string | null): ServerSpace => ({
  id: 'space-1',
  user_id: 'user-1',
  name: 'Planning',
  source_type: 'blank',
  status: 'active',
  category_key: categoryKey,
  schema_version: 1,
});

describe('Space category desktop mapping', () => {
  it('preserves an opaque content-defined category key', () => {
    expect(toLocalSpace(serverSpace('revenue-operations')).categoryKey).toBe(
      'revenue-operations'
    );
  });

  it('treats a category omitted by an older server as unset', () => {
    expect(toLocalSpace(serverSpace()).categoryKey).toBeNull();
  });
});
