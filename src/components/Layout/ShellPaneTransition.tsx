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

import { usePresenceFocusGuard } from '@/hooks/usePresenceFocusGuard';
import { motion, useIsPresent, useReducedMotion } from 'framer-motion';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Sidebar and content transitions shared by the Home and Settings pages. A
 * detail (Space, Skill, Connector) slides in from the right; returning to the
 * list slides back. The `data-home-space-*` hooks predate the split and are
 * kept so both pages expose the same pane markers.
 */
export type ShellPane = 'home' | 'detail' | 'skill-detail' | 'connector-detail';

type SpaceNavigationDirection = 1 | -1;
type SpaceNavigationMotion = 'full' | 'fade' | 'instant';
type NavigationInput = 'pointer' | 'keyboard' | 'programmatic';

export type SpaceNavigationMotionContext = {
  direction: SpaceNavigationDirection;
  mode: SpaceNavigationMotion;
};

const DRAWER_EASE = [0.32, 0.72, 0, 1] as const;
const UI_EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SIDEBAR_TRANSITION_DURATION = 0.22;
const SIDEBAR_EXIT_TRANSITION_DURATION = 0.14;
const CONTENT_TRANSITION_DURATION = 0.14;
const CONTENT_EXIT_TRANSITION_DURATION = 0.1;
const REDUCED_TRANSITION_DURATION = 0.12;
const REDUCED_EXIT_TRANSITION_DURATION = 0.1;
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
            ? REDUCED_EXIT_TRANSITION_DURATION
            : SIDEBAR_EXIT_TRANSITION_DURATION,
      ease: UI_EASE_OUT,
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
            ? REDUCED_EXIT_TRANSITION_DURATION
            : CONTENT_EXIT_TRANSITION_DURATION,
      ease: UI_EASE_OUT,
    },
  }),
};

function useExitingPaneGuard(elementRef: RefObject<HTMLElement | null>) {
  const isPresent = useIsPresent();
  usePresenceFocusGuard(elementRef, isPresent);
  return isPresent;
}

export function AnimatedSidebarPane({
  children,
  motionContext,
  pane,
}: {
  children: ReactNode;
  motionContext: SpaceNavigationMotionContext;
  pane: ShellPane;
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

export function AnimatedContentPane({
  children,
  motionContext,
  pane,
}: {
  children: ReactNode;
  motionContext: SpaceNavigationMotionContext;
  pane: ShellPane;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const isPresent = useExitingPaneGuard(paneRef);

  return (
    <motion.div
      ref={paneRef}
      data-home-space-content-pane={pane}
      data-space-navigation-direction={
        motionContext.direction === 1 ? 'forward' : 'back'
      }
      data-space-navigation-motion={motionContext.mode}
      className="absolute inset-0 flex h-full min-h-0 min-w-0 flex-col"
      custom={motionContext}
      variants={contentTransitionVariants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Pick the pane motion from the latest input: pointer navigation slides,
 * keyboard navigation is instant, and reduced motion fades.
 */
export function useShellPaneMotion(
  isDetailView: boolean
): SpaceNavigationMotionContext {
  const reduceMotion = Boolean(useReducedMotion());
  const [navigationInput, setNavigationInput] =
    useState<NavigationInput>('programmatic');

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

  return {
    direction: isDetailView ? 1 : -1,
    mode:
      navigationInput === 'keyboard'
        ? 'instant'
        : reduceMotion
          ? 'fade'
          : navigationInput === 'pointer'
            ? 'full'
            : 'instant',
  };
}
