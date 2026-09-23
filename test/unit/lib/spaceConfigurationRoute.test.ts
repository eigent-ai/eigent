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
  buildSettingsCompatibilityUrl,
  buildSpaceDetailUrl,
  isSpaceConfigurationSection,
  settingsSectionSpaceDestination,
} from '@/lib/spaceConfigurationRoute';
import { describe, expect, it } from 'vitest';

describe('spaceConfigurationRoute', () => {
  it('maps legacy settings destinations into the matching Space surface', () => {
    expect(settingsSectionSpaceDestination('models')).toEqual({
      tab: 'workspace-profile',
      configurationSection: 'space-settings-model',
    });
    expect(settingsSectionSpaceDestination('memory')).toEqual({
      tab: 'memory',
    });
    expect(settingsSectionSpaceDestination('browser-plugins')).toEqual({
      tab: 'workspace-profile',
      configurationSection: 'space-settings-environment',
    });
  });

  it('builds an encoded Space detail URL and preserves a model provider target', () => {
    expect(
      buildSpaceDetailUrl(
        'space / one',
        settingsSectionSpaceDestination('models'),
        { provider: 'provider / one' }
      )
    ).toBe(
      '/home?section=spaces&spaceId=space+%2F+one&spaceTab=workspace-profile&spaceConfig=space-settings-model&provider=provider+%2F+one'
    );
  });

  it('sends compatibility routes to the Space list when no Space is active', () => {
    expect(buildSettingsCompatibilityUrl(null, 'settings')).toBe(
      '/home?section=spaces'
    );
  });

  it('accepts only supported configuration section identifiers', () => {
    expect(isSpaceConfigurationSection('space-settings-skills')).toBe(true);
    expect(isSpaceConfigurationSection('settings')).toBe(false);
    expect(isSpaceConfigurationSection(null)).toBe(false);
  });
});
