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

import { create } from 'zustand';

export const SETTINGS_SECTIONS = [
  'workspace-profile',
  'models',
  'sub-agents',
  'connectors',
  'skills',
  'channels',
  'memory',
  'browser-connections',
  'browser-plugins',
  'cookies',
  'general',
  'appearance',
  'privacy',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];
export type SettingsScope = 'workspace' | 'device' | 'settings';

export const SETTINGS_SECTION_SCOPE: Record<SettingsSectionId, SettingsScope> =
  {
    'workspace-profile': 'workspace',
    models: 'workspace',
    'sub-agents': 'workspace',
    connectors: 'workspace',
    skills: 'workspace',
    channels: 'workspace',
    memory: 'workspace',
    'browser-connections': 'device',
    'browser-plugins': 'device',
    cookies: 'device',
    general: 'settings',
    appearance: 'settings',
    privacy: 'settings',
  };

export function isSettingsSectionId(
  value: string | null | undefined
): value is SettingsSectionId {
  return Boolean(
    value && (SETTINGS_SECTIONS as readonly string[]).includes(value)
  );
}

interface SettingsDialogState {
  isOpen: boolean;
  activeSection: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setActiveSection: (section: SettingsSectionId) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  activeSection: 'workspace-profile',
  openSettings: (section) =>
    set((state) => ({
      isOpen: true,
      activeSection: section ?? state.activeSection,
    })),
  closeSettings: () => set({ isOpen: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}));

/** Open settings from callbacks and non-React modules without route changes. */
export function openSettingsDialog(section?: SettingsSectionId) {
  useSettingsDialogStore.getState().openSettings(section);
}
