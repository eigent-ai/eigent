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
  GLOBAL_SEARCH_RECENT_LIMIT,
  searchGlobalItems,
  stepGlobalSearchType,
  type GlobalSearchItem,
} from '@/components/GlobalSearch/searchModel';
import { describe, expect, it } from 'vitest';

const item = (
  id: string,
  type: GlobalSearchItem['type'],
  title: string,
  time = 0,
  detail?: string
): GlobalSearchItem => ({ id, type, title, time, detail });

const items = [
  item('s1', 'spaces', 'Research', 5),
  item('p1', 'sessions', 'Weekly report', 30, 'Research'),
  item('p2', 'sessions', 'Report draft', 20, 'Ops'),
  item('t1', 'tasks', 'Summarize the report', 10, 'Research'),
  item('a1', 'automations', 'Morning report'),
  item('d1', 'dispatch', 'Phone link'),
];

const ids = (found: GlobalSearchItem[]) => found.map((row) => row.id);

describe('global search model', () => {
  it('shows recent Sessions in All without a query', () => {
    expect(ids(searchGlobalItems(items, 'all', ''))).toEqual(['p1', 'p2']);
  });

  it('lists a whole type without a query', () => {
    expect(ids(searchGlobalItems(items, 'tasks', ''))).toEqual(['t1']);
    expect(ids(searchGlobalItems(items, 'dispatch', ''))).toEqual(['d1']);
  });

  it('matches titles and where they live, ignoring case', () => {
    expect(ids(searchGlobalItems(items, 'sessions', 'OPS'))).toEqual(['p2']);
    expect(ids(searchGlobalItems(items, 'all', 'research'))).toEqual([
      's1',
      'p1',
      't1',
    ]);
  });

  it('puts titles that start with the query first, then the newest', () => {
    expect(ids(searchGlobalItems(items, 'all', 'report'))).toEqual([
      'p2',
      'p1',
      't1',
      'a1',
    ]);
  });

  it('keeps every type reachable in All', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      item(`p${index}`, 'sessions', `Plan ${index}`, 100 + index)
    );
    const found = searchGlobalItems(
      [...many, item('s1', 'spaces', 'Plans', 1)],
      'all',
      'plan'
    );
    expect(found.filter((row) => row.type === 'sessions')).toHaveLength(
      GLOBAL_SEARCH_RECENT_LIMIT
    );
    expect(ids(found)).toContain('s1');
  });

  it('steps through types and wraps at the ends', () => {
    expect(stepGlobalSearchType('all', 1)).toBe('spaces');
    expect(stepGlobalSearchType('all', -1)).toBe('dispatch');
    expect(stepGlobalSearchType('dispatch', 1)).toBe('all');
  });
});
