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
import SkillDetail from '@/components/Settings/Skills/components/SkillDetail';
import SkillDetailSidebar from '@/components/Settings/Skills/components/SkillDetailSidebar';
import { SkillsProvider } from '@/components/Settings/Skills/SkillsProvider';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { LegacyRouteWorkflowDialog } from '@/routers/LegacyRouteCompatibility';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  SETTINGS_SECTIONS,
  useSettingsStore,
  type SettingsSectionId,
} from '@/store/settingsStore';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

type SpaceNavigationDirection = 1 | -1;
type SpaceNavigationMotion = 'full' | 'fade' | 'instant';
type NavigationInput = 'pointer' | 'keyboard' | 'programmatic';

type SpaceNavigationMotionContext = {
  direction: SpaceNavigationDirection;
  mode: SpaceNavigationMotion;
};

const DRAWER_EASE = [0.32, 0.72, 0, 1] as const;
const UI_EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SIDEBAR_TRANSITION_DURATION = 0.22;
const CONTENT_TRANSITION_DURATION = 0.14;
const REDUCED_TRANSITION_DURATION = 0.12;
const RESTING_TRANSFORM = 'translate3d(0, 0, 0)';

const sidebarTransitionVariants = {
  enter: ({ direction, mode }: SpaceNavigationMotionContext) => ({
    opacity: mode === 'instant' ? 1 : 0,
    transform:
      mode === 'full'
        ? `translate3d(${direction === 1 ? '8%' : '-8%'}, 0, 0)`
        : RESTING_TRANSFORM,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : SIDEBAR_TRANSITION_DURATION,
      ease: DRAWER_EASE,
    },
  }),
  center: ({ mode }: SpaceNavigationMotionContext) => ({
    opacity: 1,
    transform: RESTING_TRANSFORM,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : SIDEBAR_TRANSITION_DURATION,
      ease: DRAWER_EASE,
    },
  }),
  exit: ({ direction, mode }: SpaceNavigationMotionContext) => ({
    opacity: mode === 'instant' ? 1 : 0,
    transform:
      mode === 'full'
        ? `translate3d(${direction === 1 ? '-8%' : '8%'}, 0, 0)`
        : RESTING_TRANSFORM,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : SIDEBAR_TRANSITION_DURATION,
      ease: DRAWER_EASE,
    },
  }),
};

const contentTransitionVariants = {
  enter: ({ mode }: SpaceNavigationMotionContext) => ({
    opacity: mode === 'instant' ? 1 : 0,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : CONTENT_TRANSITION_DURATION,
      ease: UI_EASE_OUT,
    },
  }),
  center: ({ mode }: SpaceNavigationMotionContext) => ({
    opacity: 1,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : CONTENT_TRANSITION_DURATION,
      ease: UI_EASE_OUT,
    },
  }),
  exit: ({ mode }: SpaceNavigationMotionContext) => ({
    opacity: mode === 'instant' ? 1 : 0,
    transition: {
      duration:
        mode === 'instant'
          ? 0
          : mode === 'fade'
            ? REDUCED_TRANSITION_DURATION
            : CONTENT_TRANSITION_DURATION,
      ease: UI_EASE_OUT,
    },
  }),
};

function useExitingPaneGuard(elementRef: RefObject<HTMLElement | null>) {
  const isPresent = useIsPresent();

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (isPresent) {
      element.removeAttribute('inert');
    } else {
      element.setAttribute('inert', '');
    }
  }, [elementRef, isPresent]);

  return isPresent;
}

function AnimatedSidebarPane({
  children,
  motionContext,
  pane,
}: {
  children: ReactNode;
  motionContext: SpaceNavigationMotionContext;
  pane: 'home' | 'detail' | 'skill-detail';
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const isPresent = useExitingPaneGuard(paneRef);

  return (
    <motion.div
      ref={paneRef}
      data-home-space-sidebar-pane={pane}
      data-space-navigation-direction={
        motionContext.direction === 1 ? 'forward' : 'back'
      }
      data-space-navigation-motion={motionContext.mode}
      aria-hidden={isPresent ? undefined : true}
      className="absolute inset-0 h-full min-h-0 w-full"
      custom={motionContext}
      variants={sidebarTransitionVariants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  );
}

function AnimatedContentPane({
  children,
  motionContext,
  pane,
}: {
  children: ReactNode;
  motionContext: SpaceNavigationMotionContext;
  pane: 'home' | 'detail' | 'skill-detail';
}) {
  const paneRef = useRef<HTMLElement>(null);
  const isPresent = useExitingPaneGuard(paneRef);

  return (
    <motion.main
      ref={paneRef}
      data-home-space-content-pane={pane}
      data-space-navigation-direction={
        motionContext.direction === 1 ? 'forward' : 'back'
      }
      data-space-navigation-motion={motionContext.mode}
      aria-hidden={isPresent ? undefined : true}
      className="absolute inset-0 flex h-full min-h-0 min-w-0 flex-col"
      custom={motionContext}
      variants={contentTransitionVariants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      {children}
    </motion.main>
  );
}

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
  const reduceMotion = Boolean(useReducedMotion());
  const [navigationInput, setNavigationInput] =
    useState<NavigationInput>('programmatic');
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
  const visibleSkillId =
    !isSpacesView && activeSection === 'skills'
      ? searchParams.get('skillId')
      : null;
  const isDetailView = Boolean(visibleSpaceId || visibleSkillId);
  const navigationDirection: SpaceNavigationDirection = isDetailView ? 1 : -1;
  const navigationMotion: SpaceNavigationMotion =
    navigationInput === 'keyboard'
      ? 'instant'
      : reduceMotion
        ? 'fade'
        : navigationInput === 'pointer'
          ? 'full'
          : 'instant';
  const navigationMotionContext: SpaceNavigationMotionContext = {
    direction: navigationDirection,
    mode: navigationMotion,
  };

  useEffect(() => {
    const handlePointerDown = () => {
      setNavigationInput('pointer');
    };
    const handleKeyDown = () => {
      setNavigationInput('keyboard');
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

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
    void runAfterWorkspaceConfigurationSave(() => {
      navigateHome('?section=spaces');
    });
  }, [navigateHome]);

  useEffect(() => {
    if (spaceId && !visibleSpaceId && routeSpace) {
      navigateHome('?section=spaces');
    }
  }, [navigateHome, routeSpace, spaceId, visibleSpaceId]);

  const handleSettingsSectionChange = useCallback(
    (section: SettingsSectionId) => {
      void runAfterWorkspaceConfigurationSave(() => {
        setActiveSection(section);
        navigateHome(`?section=settings&tab=${section}`);
      });
    },
    [navigateHome, setActiveSection]
  );

  const handleSelectSpace = useCallback(
    (nextSpaceId: string) => {
      void runAfterWorkspaceConfigurationSave(() => {
        navigateHome(
          `?section=spaces&spaceId=${encodeURIComponent(nextSpaceId)}&spaceTab=${activeSpaceTab}`
        );
      });
    },
    [activeSpaceTab, navigateHome]
  );

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

  const handleSelectSkill = (skillId: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', 'settings');
    next.set('tab', 'skills');
    if (skillId) next.set('skillId', skillId);
    else next.delete('skillId');
    navigateHome(`?${next.toString()}`);
  };
  const sidebarPane = visibleSpaceId
    ? 'detail'
    : visibleSkillId
      ? 'skill-detail'
      : 'home';
  const sidebar = (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <AnimatePresence
        initial={false}
        mode="sync"
        custom={navigationMotionContext}
      >
        <AnimatedSidebarPane
          key={sidebarPane}
          pane={sidebarPane}
          motionContext={navigationMotionContext}
        >
          {visibleSkillId ? (
            <SkillDetailSidebar
              selectedSkillId={visibleSkillId}
              onBack={() => handleSelectSkill(null)}
              onSelectSkill={handleSelectSkill}
            />
          ) : visibleSpaceId ? (
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
          )}
        </AnimatedSidebarPane>
      </AnimatePresence>
    </div>
  );

  const contentPane = sidebarPane;
  const content = visibleSkillId ? (
    <SkillDetail skillId={visibleSkillId} />
  ) : visibleSpaceId ? (
    <SpaceDetail
      spaceId={visibleSpaceId}
      activeTab={activeSpaceTab}
      onTabChange={handleSpaceTabChange}
      onBack={handleHomeSectionChange}
    />
  ) : isSpacesView ? (
    <div className="scrollbar-always-visible flex min-h-0 w-full min-w-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-y-scroll">
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
      {activeSection !== 'skills' && (
        <SettingsHeader activeSection={activeSection} />
      )}
      <SettingsSectionContent activeSection={activeSection} />
    </SettingsHeaderProvider>
  );

  return (
    <SkillsProvider active={!isSpacesView && activeSection === 'skills'}>
      <AppShellLayout sidebar={sidebar} sidebarHidden={sidebarHidden}>
        <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <AnimatePresence
            initial={false}
            mode="sync"
            custom={navigationMotionContext}
          >
            <AnimatedContentPane
              key={contentPane}
              pane={contentPane}
              motionContext={navigationMotionContext}
            >
              {content}
            </AnimatedContentPane>
          </AnimatePresence>
        </div>
      </AppShellLayout>
    </SkillsProvider>
  );
}

export default function SettingsPageRoute() {
  return (
    <HomeHubRoot>
      <HomeSettingsPageContent />
      <LegacyRouteWorkflowDialog />
    </HomeHubRoot>
  );
}
