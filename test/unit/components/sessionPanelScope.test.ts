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
  arrangeSessionPanelItems,
  selectSessionPanelRuns,
} from '@/components/Session/SidePanel/sections/sessionPanelScope';
import { describe, expect, it } from 'vitest';

const items = [
  {
    id: 'current-recently-updated',
    historical: false,
    createdAt: 400,
    updatedAt: 500,
  },
  {
    id: 'newest-history',
    historical: true,
    createdAt: 300,
    updatedAt: 100,
  },
  {
    id: 'current-less-recently-updated',
    historical: false,
    createdAt: 400,
    updatedAt: 200,
  },
  {
    id: 'oldest-history',
    historical: true,
    createdAt: 100,
    updatedAt: 400,
  },
];

describe('arrangeSessionPanelItems', () => {
  it('shows only the current run in latest mode', () => {
    const result = arrangeSessionPanelItems(items, 'latest');

    expect(result.primary.map((item) => item.id)).toEqual([
      'current-recently-updated',
      'current-less-recently-updated',
    ]);
    expect(result.earlier).toEqual([]);
  });

  it('groups previous-run items under earlier in all mode', () => {
    const result = arrangeSessionPanelItems(items, 'all');

    expect(result.primary.map((item) => item.id)).toEqual([
      'current-recently-updated',
      'current-less-recently-updated',
    ]);
    expect(result.earlier.map((item) => item.id)).toEqual([
      'newest-history',
      'oldest-history',
    ]);
  });

  it('keeps every item reachable in all mode', () => {
    const result = arrangeSessionPanelItems(items, 'all');

    expect([...result.primary, ...result.earlier]).toHaveLength(items.length);
  });

  it('can preserve a deliberately chronological source order', () => {
    const chronological = [...items].reverse();
    const result = arrangeSessionPanelItems(chronological, 'all', 'source');

    expect(result.primary.map((item) => item.id)).toEqual([
      'current-less-recently-updated',
      'current-recently-updated',
    ]);
    expect(result.earlier.map((item) => item.id)).toEqual([
      'oldest-history',
      'newest-history',
    ]);
  });
});

describe('selectSessionPanelRuns', () => {
  const runs = [
    { id: 'old', isCurrent: false, createdAt: 100, updatedAt: 500 },
    { id: 'current', isCurrent: true, createdAt: 400, updatedAt: 200 },
    { id: 'previous', isCurrent: false, createdAt: 300, updatedAt: 100 },
  ];

  it('returns only the current run in latest mode', () => {
    expect(selectSessionPanelRuns(runs, 'latest').map((run) => run.id)).toEqual(
      ['current']
    );
  });

  it('returns every run by creation time in all mode', () => {
    expect(selectSessionPanelRuns(runs, 'all').map((run) => run.id)).toEqual([
      'current',
      'previous',
      'old',
    ]);
  });
});
