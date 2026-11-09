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
import HomeSidebar from '@/components/Home/HomeSidebar';
import { HomeSidebarSlot } from '@/components/Home/HomeSidebarHost';
import SpaceDetail, {
  isSpaceDetailTab,
  type SpaceDetailTab,
} from '@/components/Home/SpaceDetail';
import AppShellLayout from '@/components/Layout/AppShellLayout';
import { ContentHeaderFrame } from '@/components/Layout/ContentHeader';
import {
  AnimatedContentPane,
  useShellPaneMotion,
} from '@/components/Layout/ShellPaneTransition';
import {
  isLegacyHomeSettingsSearch,
  settingsPageSearch,
} from '@/lib/shellRoutes';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { LegacyRouteWorkflowDialog } from '@/routers/LegacyRouteCompatibility';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';

/** Home: every Space, and one Space's Workspace page at `?spaceId=`. */
function HomePageContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sidebarHidden = usePageTabStore(
    (state) => state.workspaceSidebarHidden
  );
  const spaceId = searchParams.get('spaceId');
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const routeSpace = spaceId ? spacesById[spaceId] : null;
  const visibleSpaceId = isUnconfiguredPlaceholderSpace(
    routeSpace,
    projectsBySpaceId
  )
    ? null
    : spaceId;
  const spaceTabFromUrl = searchParams.get('spaceTab');
  const activeSpaceTab: SpaceDetailTab = isSpaceDetailTab(spaceTabFromUrl)
    ? spaceTabFromUrl
    : 'projects';
  const navigationMotionContext = useShellPaneMotion(Boolean(visibleSpaceId));

  const navigateHome = useCallback(
    (search: string) => {
      navigate(
        { pathname: '/home', search },
        { replace: true, state: location.state }
      );
    },
    [location.state, navigate]
  );

  const showSpaces = useCallback(() => {
    void runAfterWorkspaceConfigurationSave(() => {
      navigateHome('?section=spaces');
    });
  }, [navigateHome]);

  useEffect(() => {
    if (spaceId && !visibleSpaceId && routeSpace) {
      navigateHome('?section=spaces');
    }
  }, [navigateHome, routeSpace, spaceId, visibleSpaceId]);

  // A Space deleted while it's on screen leaves nothing to show here. A link
  // to a Space that was never here keeps its own message, since Spaces may
  // still be arriving.
  const shownSpaceId = useRef<string | null>(null);
  useEffect(() => {
    if (routeSpace && spaceId) {
      shownSpaceId.current = spaceId;
      return;
    }
    const deleted = spaceId !== null && shownSpaceId.current === spaceId;
    shownSpaceId.current = null;
    if (deleted) navigateHome('?section=spaces');
  }, [navigateHome, routeSpace, spaceId]);

  const handleSpaceTabChange = useCallback(
    (tab: SpaceDetailTab) => {
      if (!spaceId) return;
      void runAfterWorkspaceConfigurationSave(() => {
        navigateHome(
          `?section=spaces&spaceId=${encodeURIComponent(spaceId)}&spaceTab=${tab}`
        );
      });
    },
    [navigateHome, spaceId]
  );

  const pane = visibleSpaceId ? 'detail' : 'home';

  const content = visibleSpaceId ? (
    <SpaceDetail
      spaceId={visibleSpaceId}
      activeTab={activeSpaceTab}
      onTabChange={handleSpaceTabChange}
      onBack={showSpaces}
    />
  ) : (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <HomeHeader />
      <div className="scrollbar-always-visible min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-scroll">
        <div className="mx-auto min-h-full w-full max-w-[1100px] px-ds-32 py-ds-24">
          <HomeGreeting />
          <HomeSections />
        </div>
      </div>
    </div>
  );

  return (
    <AppShellLayout
      sidebar={
        <HomeSidebarSlot>
          <HomeSidebar />
        </HomeSidebarSlot>
      }
      sidebarHidden={sidebarHidden}
    >
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
  );
}

export default function HomePageRoute() {
  const location = useLocation();

  // Home and Settings used to share this route; send Settings links on.
  if (isLegacyHomeSettingsSearch(location.search)) {
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

  return (
    <HomeHubRoot>
      <HomePageContent />
      <LegacyRouteWorkflowDialog />
    </HomeHubRoot>
  );
}
