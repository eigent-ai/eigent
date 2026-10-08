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

import { getSessionDisplayName } from '@/lib/spaceLabel';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

const t = ((key: string) =>
  key === 'layout.new-project' ? 'New session' : key) as unknown as TFunction;

describe('getSessionDisplayName', () => {
  it.each([
    ['new project'],
    ['New Project'],
    ['  new project  '],
    [''],
    [null],
    [undefined],
    ['Project session-1'],
  ])('shows the localized label for the system default name %j', (name) => {
    expect(getSessionDisplayName(name, 'session-1', t)).toBe('New session');
  });

  it('keeps names the user chose', () => {
    expect(getSessionDisplayName('Launch plan', 'session-1', t)).toBe(
      'Launch plan'
    );
    expect(getSessionDisplayName('  Launch plan ', 'session-1', t)).toBe(
      'Launch plan'
    );
    expect(getSessionDisplayName('Project session-2', 'session-1', t)).toBe(
      'Project session-2'
    );
  });
});
