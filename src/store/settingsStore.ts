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
  'models',
  'sub-agents',
  'connectors',
  'skills',
  'channels',
  'memory',
  'browser-connections',
  'browser-plugins',
  'cookies',
  'settings',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];
export type SettingsScope = 'global' | 'device' | 'settings';

interface SettingsState {
  isOpen: boolean;
  activeSection: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setActiveSection: (section: SettingsSectionId) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  activeSection: 'models',
  openSettings: (section) =>
    set((state) => ({
      isOpen: true,
      activeSection: section ?? state.activeSection,
    })),
  closeSettings: () => set({ isOpen: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}));

/** Open settings from callbacks and non-React modules without route changes. */
export function openSettings(section?: SettingsSectionId) {
  useSettingsStore.getState().openSettings(section);
}
