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
  nextNeedsYouOrder,
  orderBySnapshot,
  spaceLastActivity,
} from '@/components/Home/homeSidebarModel';
import { describe, expect, it } from 'vitest';

describe('Home sidebar ordering', () => {
  it("takes a Space's last activity from it or its newest Session", () => {
    expect(spaceLastActivity({ updatedAt: 5 }, [])).toBe(5);
    expect(
      spaceLastActivity({ updatedAt: 5 }, [{ updatedAt: 3 }, { updatedAt: 9 }])
    ).toBe(9);
  });

  it('orders by the snapshot and puts ids it has not seen first', () => {
    expect(
      orderBySnapshot(['old', 'new', 'newer', 'middle'], {
        old: 1,
        middle: 5,
        newer: 9,
      })
    ).toEqual(['new', 'newer', 'middle', 'old']);
  });

  it('keeps input order among ties and unknown ids', () => {
    expect(orderBySnapshot(['a', 'b', 'c'], { a: 1, b: 1 })).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('Needs you order', () => {
  const listed = (id: string) => id !== 'deleted';

  it('keeps waiting rows in place and appends new ones', () => {
    expect(
      nextNeedsYouOrder(
        ['b', 'a'],
        { a: 'waiting', b: 'waiting', c: 'waiting', d: 'running' },
        listed
      )
    ).toEqual(['b', 'a', 'c']);
  });

  it('drops answered and unlisted Sessions', () => {
    expect(
      nextNeedsYouOrder(
        ['a', 'b', 'deleted'],
        { a: 'running', b: 'waiting', deleted: 'waiting' },
        listed
      )
    ).toEqual(['b']);
  });
});
