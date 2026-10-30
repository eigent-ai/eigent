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

import type { SettingsScope, SettingsSectionId } from '@/store/settingsStore';
import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Brain,
  Cable,
  Cookie,
  Globe,
  Puzzle,
  Radio,
  Settings,
  Sparkles,
  WandSparkles,
} from 'lucide-react';

export interface SettingsNavigationItem {
  id: SettingsSectionId;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
}

export interface SettingsNavigationGroup {
  scope: SettingsScope;
  labelKey: string;
  defaultLabel: string;
  items: SettingsNavigationItem[];
}

export const SETTINGS_NAVIGATION: SettingsNavigationGroup[] = [
  {
    scope: 'global',
    labelKey: 'layout.global-setting',
    defaultLabel: 'Global Settings',
    items: [
      {
        id: 'models',
        labelKey: 'setting.models',
        defaultLabel: 'Models',
        icon: Sparkles,
      },
      {
        id: 'sub-agents',
        labelKey: 'setting.sub-agents',
        defaultLabel: 'Sub-agents',
        icon: Bot,
      },
      {
        id: 'skills',
        labelKey: 'agents.skills',
        defaultLabel: 'Skills',
        icon: WandSparkles,
      },
      {
        id: 'connectors',
        labelKey: 'layout.connectors',
        defaultLabel: 'Connectors',
        icon: Cable,
      },
      {
        id: 'channels',
        labelKey: 'layout.channels',
        defaultLabel: 'Channels',
        icon: Radio,
      },
      {
        id: 'memory',
        labelKey: 'agents.memory',
        defaultLabel: 'Memory',
        icon: Brain,
      },
    ],
  },
  {
    scope: 'device',
    labelKey: 'layout.device',
    defaultLabel: 'Device',
    items: [
      {
        id: 'browser-connections',
        labelKey: 'layout.browser',
        defaultLabel: 'Browser',
        icon: Globe,
      },
      {
        id: 'browser-plugins',
        labelKey: 'layout.browser-extension',
        defaultLabel: 'Extension',
        icon: Puzzle,
      },
      {
        id: 'cookies',
        labelKey: 'layout.browser-cookie',
        defaultLabel: 'Cookies',
        icon: Cookie,
      },
    ],
  },
  {
    scope: 'settings',
    labelKey: 'layout.settings',
    defaultLabel: 'Settings',
    items: [
      {
        id: 'settings',
        labelKey: 'layout.settings',
        defaultLabel: 'Settings',
        icon: Settings,
      },
    ],
  },
];

export function getSettingsNavigationItem(section: SettingsSectionId) {
  for (const group of SETTINGS_NAVIGATION) {
    const item = group.items.find((candidate) => candidate.id === section);
    if (item) return item;
  }
  return SETTINGS_NAVIGATION[0].items[0];
}
