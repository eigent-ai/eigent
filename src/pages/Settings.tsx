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
import { ContentHeaderFrame } from '@/components/Layout/ContentHeader';
import {
  AnimatedContentPane,
  AnimatedSidebarPane,
  useShellPaneMotion,
} from '@/components/Layout/ShellPaneTransition';
import {
  SettingsHeader,
  SettingsHeaderProvider,
  SettingsSectionContent,
  SettingsSidebar,
} from '@/components/Settings';
import ConnectorDetailSidebar from '@/components/Settings/Connectors/components/ConnectorDetailSidebar';
import { ConnectorsNavigationProvider } from '@/components/Settings/Connectors/ConnectorsNavigationContext';
import SkillDetail from '@/components/Settings/Skills/components/SkillDetail';
import SkillDetailSidebar from '@/components/Settings/Skills/components/SkillDetailSidebar';
import { SkillsProvider } from '@/components/Settings/Skills/SkillsProvider';
import {
  isSettingsSection,
  settingsPageSearch,
  shellDetailBackTarget,
  withoutShellDetailBackState,
} from '@/lib/shellRoutes';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  useSettingsStore,
  type SettingsSectionId,
} from '@/store/settingsStore';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';

/**
 * Settings: app-wide sections at `?tab=`, plus the Skill (`skillId`) and
 * Connector (`connectorId`, `connectorView=add`) details. The section store
 * stays in sync so `openSettings()` without a section reopens the last one.
 */
function SettingsPageContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const storedActiveSection = useSettingsStore((state) => state.activeSection);
  const setActiveSection = useSettingsStore((state) => state.setActiveSection);
  const sidebarHidden = usePageTabStore(
    (state) => state.workspaceSidebarHidden
  );
  const tabFromUrl = searchParams.get('tab');
  const activeSection = isSettingsSection(tabFromUrl)
    ? tabFromUrl
    : storedActiveSection;
  const visibleSkillId =
    activeSection === 'skills' ? searchParams.get('skillId') : null;
  const visibleConnectorId =
    activeSection === 'connectors' ? searchParams.get('connectorId') : null;
  const connectorView =
    activeSection === 'connectors' ? searchParams.get('connectorView') : null;
  const visibleConnectorTarget =
    connectorView === 'add' ? searchParams.get('connectorTarget') : null;
  const isConnectorSubpage = Boolean(
    visibleConnectorId || connectorView === 'add'
  );
  const navigationMotionContext = useShellPaneMotion(
    Boolean(visibleSkillId || isConnectorSubpage)
  );

  useEffect(() => {
    if (activeSection !== storedActiveSection) {
      setActiveSection(activeSection);
    }
  }, [activeSection, setActiveSection, storedActiveSection]);

  const navigateSettings = useCallback(
    (search: string) => {
      navigate(
        { pathname: '/settings', search },
        { replace: true, state: location.state }
      );
    },
    [location.state, navigate]
  );

  const navigateFromDetail = useCallback(
    (fallbackSearch: string) => {
      void runAfterWorkspaceConfigurationSave(() => {
        const routeState = location.state as Record<string, unknown> | null;
        const target = shellDetailBackTarget(routeState);
        const currentRoute = `${location.pathname}${location.search}`;
        if (target && target !== currentRoute) {
          navigate(-1);
          return;
        }
        navigate(
          { pathname: '/settings', search: fallbackSearch },
          { replace: true, state: withoutShellDetailBackState(routeState) }
        );
      });
    },
    [location.pathname, location.search, location.state, navigate]
  );

  const handleSkillDetailBack = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'skills');
    next.delete('skillId');
    navigateFromDetail(`?${next.toString()}`);
  }, [navigateFromDetail, searchParams]);

  const handleConnectorDetailBack = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'connectors');
    next.delete('connectorId');
    next.delete('connectorView');
    next.delete('connectorAdd');
    next.delete('connectorTarget');
    navigateFromDetail(`?${next.toString()}`);
  }, [navigateFromDetail, searchParams]);

  const handleSectionChange = useCallback(
    (section: SettingsSectionId) => {
      void runAfterWorkspaceConfigurationSave(() => {
        setActiveSection(section);
        navigateSettings(`?tab=${section}`);
      });
    },
    [navigateSettings, setActiveSection]
  );

  const handleSelectSkill = (skillId: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'skills');
    if (skillId) next.set('skillId', skillId);
    else next.delete('skillId');
    navigateSettings(`?${next.toString()}`);
  };
  const handleSelectConnector = (connectorId: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'connectors');
    next.delete('connectorView');
    next.delete('connectorAdd');
    next.delete('connectorTarget');
    if (connectorId) next.set('connectorId', connectorId);
    else next.delete('connectorId');
    navigateSettings(`?${next.toString()}`);
  };
  const handleAddConnector = () => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'connectors');
    next.set('connectorView', 'add');
    next.set('connectorAdd', 'browse');
    next.delete('connectorId');
    next.delete('connectorTarget');
    navigateSettings(`?${next.toString()}`);
  };
  const pane = visibleSkillId
    ? 'skill-detail'
    : isConnectorSubpage
      ? 'connector-detail'
      : 'home';
  const sidebar = (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <AnimatePresence
        initial={false}
        mode="sync"
        custom={navigationMotionContext}
      >
        <AnimatedSidebarPane
          key={pane}
          pane={pane}
          motionContext={navigationMotionContext}
        >
          {isConnectorSubpage ? (
            <ConnectorDetailSidebar
              selectedConnectorId={visibleConnectorId || visibleConnectorTarget}
              onBack={handleConnectorDetailBack}
              onAddConnector={handleAddConnector}
              onSelectConnector={handleSelectConnector}
            />
          ) : visibleSkillId ? (
            <SkillDetailSidebar
              selectedSkillId={visibleSkillId}
              onBack={handleSkillDetailBack}
              onSelectSkill={handleSelectSkill}
            />
          ) : (
            <SettingsSidebar
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
            />
          )}
        </AnimatedSidebarPane>
      </AnimatePresence>
    </div>
  );

  const content = visibleSkillId ? (
    <SkillDetail
      skillId={visibleSkillId}
      onNavigateToSkills={() => handleSelectSkill(null)}
    />
  ) : (
    <SettingsHeaderProvider activeSection={activeSection}>
      {activeSection !== 'skills' &&
        activeSection !== 'connectors' &&
        activeSection !== 'models' && (
          <SettingsHeader activeSection={activeSection} />
        )}
      <SettingsSectionContent
        activeSection={activeSection}
        contentClassName={isConnectorSubpage ? 'max-w-none px-0' : undefined}
        layout={
          activeSection === 'models' ||
          activeSection === 'skills' ||
          (activeSection === 'connectors' && !isConnectorSubpage)
            ? 'collection'
            : 'content'
        }
      />
    </SettingsHeaderProvider>
  );

  return (
    <SkillsProvider active={activeSection === 'skills'}>
      <ConnectorsNavigationProvider>
        <AppShellLayout sidebar={sidebar} sidebarHidden={sidebarHidden}>
          <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <ContentHeaderFrame>
              <div className="relative min-h-0 flex-1">
                <AnimatePresence
                  initial={false}
                  mode="sync"
                  custom={navigationMotionContext}
                >
                  <AnimatedContentPane
                    key={pane}
                    pane={pane}
                    motionContext={navigationMotionContext}
                  >
                    {content}
                  </AnimatedContentPane>
                </AnimatePresence>
              </div>
            </ContentHeaderFrame>
          </main>
        </AppShellLayout>
      </ConnectorsNavigationProvider>
    </SkillsProvider>
  );
}

export default function SettingsPageRoute() {
  const location = useLocation();
  const section = new URLSearchParams(location.search).get('section');

  // The Spaces hub moved to Home before Home and Settings were split.
  if (section === 'spaces') {
    return (
      <Navigate
        to={{ pathname: '/home', search: location.search }}
        replace
        state={location.state}
      />
    );
  }
  // Older links carry `section`; settle on the canonical `?tab=` search.
  if (section !== null) {
    return (
      <Navigate
        to={{
          pathname: '/settings',
          search: settingsPageSearch(location.search),
        }}
        replace
        state={location.state}
      />
    );
  }

  return <SettingsPageContent />;
}
