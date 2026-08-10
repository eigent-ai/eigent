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

import AppShellLayout from '@/components/Layout/AppShellLayout';
import {
  SettingsHeader,
  SettingsHeaderProvider,
  SettingsSectionContent,
  SettingsSidebar,
} from '@/components/Settings';
import { useShellBackTarget } from '@/hooks/useShellBackTarget';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Settings as a first-class page in the app shell: the former dialog menu is
 * the sidebar rail, the section body fills the content pane.
 */
export default function SettingsPageRoute() {
  const activeSection = useSettingsStore((state) => state.activeSection);
  const setActiveSection = useSettingsStore((state) => state.setActiveSection);
  // Same destination as the title-bar back button.
  const { goBack } = useShellBackTarget();

  return (
    <AppShellLayout
      sidebar={
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
      }
    >
      <SettingsHeaderProvider activeSection={activeSection}>
        <SettingsHeader activeSection={activeSection} onClose={goBack} />
        <SettingsSectionContent activeSection={activeSection} />
      </SettingsHeaderProvider>
    </AppShellLayout>
  );
}
