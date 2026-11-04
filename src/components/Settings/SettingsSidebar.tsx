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

import { fetchConnectedProviders } from '@/api/connectors';
import { fetchGet } from '@/api/http';
import {
  NavTab,
  SidebarCountBadge,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { DsIcon } from '@/components/ui/ds-icon';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { useHost } from '@/host';
import { selectableConfiguredModels } from '@/lib/configuredModels';
import { useAuthStore } from '@/store/authStore';
import { useSettingsResourceCountsStore } from '@/store/settingsResourceCountsStore';
import type { SettingsSectionId } from '@/store/settingsStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorsNavigation } from './Connectors/ConnectorsNavigationContext';
import { preloadSettingsSection } from './SettingsSectionContent';
import { useSkillsLibrary } from './Skills/SkillsProvider';
import { SETTINGS_NAVIGATION } from './settingsNavigation';

interface SettingsSidebarProps {
  activeSection: SettingsSectionId | null;
  onSectionChange: (section: SettingsSectionId) => void;
  className?: string;
}

/** Settings sidebar: the app-wide sections, grouped by scope. */
export default function SettingsSidebar({
  activeSection,
  onSectionChange,
  className,
}: SettingsSidebarProps) {
  const { t } = useTranslation();
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const codexModelType = useAuthStore((state) => state.codex_model_type);
  const {
    entries: skills,
    loading: skillsLoading,
    profilesLoading: skillProfilesLoading,
  } = useSkillsLibrary();
  const { items: connectorItems, loading: connectorsLoading } =
    useConnectorsNavigation();
  const models = useConfiguredModels();
  const planKey = useUsageNoticeStore((state) => state.subscription?.plan_key);
  const browserCount = useSettingsResourceCountsStore(
    (state) => state.counts['browser-connections']
  );
  const cookieCount = useSettingsResourceCountsStore(
    (state) => state.counts.cookies
  );
  const setResourceCount = useSettingsResourceCountsStore(
    (state) => state.setCount
  );
  const [initialConnectorCount, setInitialConnectorCount] = useState<
    number | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    if (!email) {
      setInitialConnectorCount(0);
    } else {
      setInitialConnectorCount(null);
      void fetchConnectedProviders()
        .then((providers) => {
          if (!cancelled) setInitialConnectorCount(providers.length);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (browserCount != null) return;
    let cancelled = false;
    const electronAPI = host?.electronAPI;

    const browsersRequest = electronAPI?.getCdpBrowsers
      ? electronAPI.getCdpBrowsers()
      : fetchGet('/browser/cdp/list');
    void Promise.resolve(browsersRequest)
      .then((browsers) => {
        if (!cancelled) {
          setResourceCount(
            'browser-connections',
            Array.isArray(browsers) ? browsers.length : 0
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [browserCount, host?.electronAPI, setResourceCount]);

  useEffect(() => {
    if (cookieCount != null) return;
    let cancelled = false;

    void fetchGet('/browser/cookies')
      .then((response) => {
        if (!cancelled) {
          setResourceCount(
            'cookies',
            Array.isArray(response?.domains) ? response.domains.length : 0
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [cookieCount, setResourceCount]);

  const connectorCount = connectorsLoading
    ? initialConnectorCount
    : connectorItems.length;
  const modelCount = models.loading
    ? null
    : selectableConfiguredModels({
        ...models,
        codexModelType,
        planKey,
      }).length;
  const sectionCounts: Partial<Record<SettingsSectionId, number | null>> = {
    models: modelCount,
    skills: skillsLoading || skillProfilesLoading ? null : skills.length,
    connectors: connectorCount,
    'browser-connections': browserCount,
    cookies: cookieCount,
  };

  return (
    <SidebarShell
      className={className}
      ariaLabel={t('layout.settings', { defaultValue: 'Settings' })}
    >
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel={t('layout.settings', { defaultValue: 'Settings' })}
          // Centers the first heading on the rail's Home icon.
          className="gap-4 pt-2"
        >
          {SETTINGS_NAVIGATION.map((group) => (
            <SidebarNavGroup
              key={group.scope}
              label={
                group.label
                  ? t(group.label.key, {
                      defaultValue: group.label.defaultValue,
                    })
                  : undefined
              }
            >
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                const label = t(item.labelKey, {
                  defaultValue: item.defaultLabel,
                });
                const count = sectionCounts[item.id];
                return (
                  <NavTab
                    key={item.id}
                    active={active}
                    onClick={() => onSectionChange(item.id)}
                    leading={<DsIcon icon={Icon} />}
                    label={label}
                    trailing={
                      count == null ? undefined : (
                        <SidebarCountBadge count={count} />
                      )
                    }
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
