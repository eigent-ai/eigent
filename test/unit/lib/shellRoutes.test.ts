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
  isHomePagePath,
  isLegacyHomeSettingsSearch,
  isSettingsPagePath,
  isSettingsRoutePath,
  settingsPageSearch,
  shellBackState,
  shellDetailBackState,
  shellDetailBackTarget,
  withoutShellDetailBackState,
} from '@/lib/shellRoutes';
import { describe, expect, it } from 'vitest';

describe('isSettingsRoutePath', () => {
  it.each(['/home', '/home/', '/Home', '/settings', '/settings/', '/Settings'])(
    'matches the Home management route for %s',
    (pathname) => {
      expect(isSettingsRoutePath(pathname)).toBe(true);
    }
  );

  it.each(['/', '/home/spaces', '/settings/models'])(
    'rejects %s',
    (pathname) => {
      expect(isSettingsRoutePath(pathname)).toBe(false);
    }
  );
});

describe('detail back state', () => {
  it('prefers the page that opened the detail and retains the shell origin', () => {
    const state = shellDetailBackState(
      shellBackState('/'),
      '/home?section=settings&tab=skills&skillFilter=global'
    );

    expect(shellDetailBackTarget(state)).toBe(
      '/home?section=settings&tab=skills&skillFilter=global'
    );
    expect(withoutShellDetailBackState(state)).toEqual({ from: '/' });
  });

  it('returns to the workspace shell origin for a directly opened detail', () => {
    expect(shellDetailBackTarget(shellBackState('/'))).toBe('/');
  });

  it('ignores external-looking router state', () => {
    expect(
      shellDetailBackTarget({
        detailFrom: 'https://example.com',
        from: '//example.com',
      })
    ).toBeNull();
  });
});

describe('Home and Settings page paths', () => {
  it('tells the two pages apart', () => {
    expect(isHomePagePath('/home')).toBe(true);
    expect(isHomePagePath('/settings')).toBe(false);
    expect(isSettingsPagePath('/settings')).toBe(true);
    expect(isSettingsPagePath('/home')).toBe(false);
    expect(isSettingsPagePath('/')).toBe(false);
  });
});

describe('settingsPageSearch', () => {
  it.each([
    [
      '?section=settings&tab=models&provider=ant-ling',
      '?tab=models&provider=ant-ling',
    ],
    ['?section=models', '?tab=models'],
    ['?section=settings', ''],
    ['?section=skills&tab=connectors', '?tab=connectors'],
    [
      '?section=settings&tab=skills&skillId=global%3Aresearch',
      '?tab=skills&skillId=global%3Aresearch',
    ],
    ['?tab=memory', '?tab=memory'],
    ['', ''],
  ])('folds %s into %s', (search, expected) => {
    expect(settingsPageSearch(search)).toBe(expected);
  });
});

describe('isLegacyHomeSettingsSearch', () => {
  it.each([
    ['', false],
    ['?section=spaces', false],
    ['?section=spaces&spaceId=space-1', false],
    ['?section=settings&tab=models', true],
    ['?section=models', true],
  ])('%s -> %s', (search, expected) => {
    expect(isLegacyHomeSettingsSearch(search)).toBe(expected);
  });
});
