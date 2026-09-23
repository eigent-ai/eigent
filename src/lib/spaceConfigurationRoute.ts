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

import type { SettingsSectionId } from '@/store/settingsStore';

export const SPACE_CONFIGURATION_SECTIONS = [
  'space-settings-identity',
  'space-settings-model',
  'space-settings-environment',
  'space-settings-instructions',
  'space-settings-context',
  'space-settings-agents',
  'space-settings-skills',
  'space-settings-connectors',
  'space-settings-mcp-servers',
] as const;

export type SpaceConfigurationSection =
  (typeof SPACE_CONFIGURATION_SECTIONS)[number];

export function isSpaceConfigurationSection(
  value: unknown
): value is SpaceConfigurationSection {
  return SPACE_CONFIGURATION_SECTIONS.includes(
    value as SpaceConfigurationSection
  );
}

export interface SpaceDetailDestination {
  tab: 'memory' | 'workspace-profile';
  configurationSection?: SpaceConfigurationSection;
}

const SETTINGS_SPACE_DESTINATIONS: Record<
  SettingsSectionId,
  SpaceDetailDestination
> = {
  models: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-model',
  },
  'sub-agents': {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-agents',
  },
  connectors: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-connectors',
  },
  skills: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-skills',
  },
  channels: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-connectors',
  },
  memory: { tab: 'memory' },
  'browser-connections': {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-environment',
  },
  'browser-plugins': {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-environment',
  },
  cookies: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-environment',
  },
  settings: {
    tab: 'workspace-profile',
    configurationSection: 'space-settings-identity',
  },
};

export function settingsSectionSpaceDestination(
  section: SettingsSectionId
): SpaceDetailDestination {
  return SETTINGS_SPACE_DESTINATIONS[section];
}

export function buildSpaceDetailUrl(
  spaceId: string,
  destination: SpaceDetailDestination,
  options: { provider?: string | null } = {}
): string {
  const searchParams = new URLSearchParams({
    section: 'spaces',
    spaceId,
    spaceTab: destination.tab,
  });
  if (destination.configurationSection) {
    searchParams.set('spaceConfig', destination.configurationSection);
  }
  if (options.provider) searchParams.set('provider', options.provider);
  return `/home?${searchParams.toString()}`;
}

export function buildSettingsCompatibilityUrl(
  spaceId: string | null,
  section: SettingsSectionId,
  options: { provider?: string | null } = {}
): string {
  if (!spaceId) return '/home?section=spaces';
  return buildSpaceDetailUrl(
    spaceId,
    settingsSectionSpaceDestination(section),
    options
  );
}
