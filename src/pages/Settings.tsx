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

import HomeHubRoot, {
  HomeGreeting,
  HomeHeader,
  HomeSections,
} from '@/components/Home';
import SpaceDetail, {
  isSpaceDetailTab,
  type SpaceDetailTab,
} from '@/components/Home/SpaceDetail';
import SpaceDetailSidebar from '@/components/Home/SpaceDetailSidebar';
import AppShellLayout from '@/components/Layout/AppShellLayout';
import {
  SettingsHeader,
  SettingsHeaderProvider,
  SettingsSectionContent,
  SettingsSidebar,
} from '@/components/Settings';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
  useSettingsStore,
} from '@/store/settingsStore';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

function isSettingsSection(value: string | null): value is SettingsSectionId {
  return SETTINGS_SECTIONS.includes(value as SettingsSectionId);
}

/**
 * Home and Settings share one page and one navigation rail. Home sections are
 * URL-addressable while Settings keeps its existing section store.
 */
function HomeSettingsPageContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const storedActiveSection = useSettingsStore((state) => state.activeSection);
  const setActiveSection = useSettingsStore((state) => state.setActiveSection);
  const sidebarHidden = usePageTabStore(
    (state) => state.workspaceSidebarHidden
  );
  const sectionFromUrl = searchParams.get('section');
  const isSpacesView = sectionFromUrl === null || sectionFromUrl === 'spaces';
  const spaceId = isSpacesView ? searchParams.get('spaceId') : null;
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const routeSpace = spaceId ? spacesById[spaceId] : null;
  const visibleSpaceId = isUnconfiguredPlaceholderSpace(
    routeSpace,
    projectsBySpaceId
  )
    ? null
    : spaceId;
  const tabFromUrl = searchParams.get('tab');
  const legacySection = isSettingsSection(sectionFromUrl)
    ? sectionFromUrl
    : null;
  const activeSection = isSettingsSection(tabFromUrl)
    ? tabFromUrl
    : (legacySection ?? storedActiveSection);
  const spaceTabFromUrl = searchParams.get('spaceTab');
  const activeSpaceTab: SpaceDetailTab = isSpaceDetailTab(spaceTabFromUrl)
    ? spaceTabFromUrl
    : 'projects';

  useEffect(() => {
    if (!isSpacesView && activeSection !== storedActiveSection) {
      setActiveSection(activeSection);
    }
  }, [activeSection, isSpacesView, setActiveSection, storedActiveSection]);

  const navigateHome = useCallback(
    (search: string) => {
      navigate(
        { pathname: '/home', search },
        { replace: true, state: location.state }
      );
    },
    [location.state, navigate]
  );

  const handleHomeSectionChange = useCallback(() => {
    navigateHome('?section=spaces');
  }, [navigateHome]);

  useEffect(() => {
    if (spaceId && !visibleSpaceId && routeSpace) {
      navigateHome('?section=spaces');
    }
  }, [navigateHome, routeSpace, spaceId, visibleSpaceId]);

  const handleSettingsSectionChange = useCallback(
    (section: SettingsSectionId) => {
      setActiveSection(section);
      navigateHome(`?section=settings&tab=${section}`);
    },
    [navigateHome, setActiveSection]
  );

  const handleSelectSpace = useCallback(
    (nextSpaceId: string) => {
      navigateHome(
        `?section=spaces&spaceId=${encodeURIComponent(nextSpaceId)}&spaceTab=${activeSpaceTab}`
      );
    },
    [activeSpaceTab, navigateHome]
  );

  const handleSpaceTabChange = useCallback(
    (tab: SpaceDetailTab) => {
      if (!spaceId) return;
      navigateHome(
        `?section=spaces&spaceId=${encodeURIComponent(spaceId)}&spaceTab=${tab}`
      );
    },
    [navigateHome, spaceId]
  );

  const sidebar = visibleSpaceId ? (
    <SpaceDetailSidebar
      selectedSpaceId={visibleSpaceId}
      onBack={handleHomeSectionChange}
      onSelectSpace={handleSelectSpace}
    />
  ) : (
    <SettingsSidebar
      activeHomeSection={isSpacesView ? 'spaces' : null}
      activeSection={isSpacesView ? null : activeSection}
      onHomeSectionChange={handleHomeSectionChange}
      onSectionChange={handleSettingsSectionChange}
    />
  );

  return (
    <AppShellLayout sidebar={sidebar} sidebarHidden={sidebarHidden}>
      <main className="flex h-full min-h-0 min-w-0 flex-col">
        {visibleSpaceId ? (
          <SpaceDetail
            spaceId={visibleSpaceId}
            activeTab={activeSpaceTab}
            onTabChange={handleSpaceTabChange}
            onBack={handleHomeSectionChange}
          />
        ) : isSpacesView ? (
          <div className="scrollbar-always-visible flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-scroll [scrollbar-gutter:stable]">
            <div className="min-h-full px-8 py-6">
              <div className="mx-auto w-full max-w-[1100px]">
                <HomeGreeting />
                <div className="mt-8">
                  <HomeHeader />
                  <HomeSections />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <SettingsHeaderProvider activeSection={activeSection}>
            <SettingsHeader activeSection={activeSection} />
            <SettingsSectionContent activeSection={activeSection} />
          </SettingsHeaderProvider>
        )}
      </main>
    </AppShellLayout>
  );
}

export default function SettingsPageRoute() {
  return (
    <HomeHubRoot>
      <HomeSettingsPageContent />
    </HomeHubRoot>
  );
}
