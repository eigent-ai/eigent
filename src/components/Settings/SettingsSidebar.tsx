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

import { HomeSidebarNavGroup } from '@/components/Home';
import type { HomeSection } from '@/components/Home/hooks/useHomeSection';
import {
  NavTab,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import type { SettingsSectionId } from '@/store/settingsStore';
import { useTranslation } from 'react-i18next';
import { preloadSettingsSection } from './SettingsSectionContent';
import { SETTINGS_NAVIGATION } from './settingsNavigation';

interface SettingsSidebarProps {
  activeHomeSection: HomeSection | null;
  activeSection: SettingsSectionId | null;
  onHomeSectionChange: (section: HomeSection) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  className?: string;
}

/** Combined Home / Settings rail, using the former Settings page layout. */
export default function SettingsSidebar({
  activeHomeSection,
  activeSection,
  onHomeSectionChange,
  onSectionChange,
  className,
}: SettingsSidebarProps) {
  const { t } = useTranslation();

  return (
    <SidebarShell
      className={className}
      ariaLabel={t('layout.home', { defaultValue: 'Home' })}
    >
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel={t('layout.home', { defaultValue: 'Home' })}
          className="gap-4 pt-1"
        >
          <HomeSidebarNavGroup
            activeSection={activeHomeSection}
            onSectionChange={onHomeSectionChange}
          />
          {SETTINGS_NAVIGATION.map((group) => (
            <SidebarNavGroup
              key={group.scope}
              label={t(group.labelKey, { defaultValue: group.defaultLabel })}
            >
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                const label = t(item.labelKey, {
                  defaultValue: item.defaultLabel,
                });
                return (
                  <NavTab
                    key={item.id}
                    active={active}
                    onClick={() => onSectionChange(item.id)}
                    leading={<Icon className="h-4 w-4 shrink-0" aria-hidden />}
                    label={label}
                    ariaLabel={label}
                    ariaCurrentPage={active}
                    onPointerEnter={() => preloadSettingsSection(item.id)}
                    onFocus={() => preloadSettingsSection(item.id)}
                  />
                );
              })}
            </SidebarNavGroup>
          ))}
        </SidebarScrollArea>
      </SidebarSection>
    </SidebarShell>
  );
}
