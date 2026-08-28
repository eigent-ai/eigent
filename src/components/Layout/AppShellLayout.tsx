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

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { SIDEBAR_FOLD_SPRING } from './AppSidebar/constants';

/** Fixed rail width. The sidebar is no longer resizable. */
export const APP_SHELL_SIDEBAR_WIDTH_PX = 240;
/** Sidebar tabs sit inside the rail's shared `p-1` inset. */
export const APP_SHELL_SIDEBAR_TAB_INSET_PX = 4;
/** Gap between the rail and the content pane. */
export const APP_SHELL_COLUMN_GAP_PX = 2;

/** Content pane surface — the rounded card every page renders its body into. */
export const APP_SHELL_CONTENT_SURFACE_CLASS =
  'bg-ds-neutral-subtle-default min-w-0 flex h-full w-full flex-col overflow-hidden';
/** Inner column inside the surface (header + body). */
export const APP_SHELL_CONTENT_CLASS =
  'min-h-0 min-w-0 flex h-full w-full flex-col';

export interface AppShellLayoutProps {
  /** Page rail — compose it from `@/components/Layout/AppSidebar`. */
  sidebar: ReactNode;
  /** Content pane; typically `<ContentHeader/>` plus a scrolling body. */
  children: ReactNode;
  /** Rendered after the columns (e.g. always-mounted webview layers). */
  overlay?: ReactNode;
  /**
   * Collapse the destination rail away. The shared top-bar control drives this
   * on both Workspace and Home.
   */
  sidebarHidden?: boolean;
  /**
   * Wrap `children` in the rounded content surface (default). Pages that paint
   * their own surface (or need several) can opt out.
   */
  contentSurface?: boolean;
  className?: string;
  contentClassName?: string;
}

/**
 * Shared page frame below the `TopBar`: a fixed-width sidebar and content pane.
 * Workspace, Home and Settings all render through it so the rail width, gutters
 * and motion are identical across pages.
 */
export default function AppShellLayout({
  sidebar,
  children,
  overlay,
  sidebarHidden = false,
  contentSurface = true,
  className,
  contentClassName,
}: AppShellLayoutProps) {
  const sidebarRailRef = useRef<HTMLDivElement>(null);

  // React 18 does not support the boolean `inert` JSX prop. Set the native
  // attribute before paint so a folded rail and all of its descendants leave
  // the focus order and accessibility tree while its width animates closed.
  useLayoutEffect(() => {
    const sidebarRail = sidebarRailRef.current;
    if (!sidebarRail) return;

    if (sidebarHidden) {
      sidebarRail.setAttribute('inert', '');
    } else {
      sidebarRail.removeAttribute('inert');
    }
  }, [sidebarHidden]);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-row overflow-hidden pt-10',
        className
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden rounded-2xl bg-ds-neutral-default-default">
        <motion.div
          ref={sidebarRailRef}
          className="h-full min-h-0 shrink-0 overflow-hidden"
          initial={false}
          animate={{
            width: sidebarHidden
              ? 0
              : APP_SHELL_SIDEBAR_WIDTH_PX + APP_SHELL_COLUMN_GAP_PX,
          }}
          transition={SIDEBAR_FOLD_SPRING}
          aria-hidden={sidebarHidden}
          style={{ pointerEvents: sidebarHidden ? 'none' : undefined }}
        >
          {/* Fixed inner width so rail content doesn't reflow mid-animation. */}
          <div
            className="h-full min-h-0"
            style={{ width: APP_SHELL_SIDEBAR_WIDTH_PX }}
          >
            {sidebar}
          </div>
        </motion.div>

        <motion.div
          layout
          transition={{ layout: SIDEBAR_FOLD_SPRING }}
          className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {contentSurface ? (
            <div
              className={cn(APP_SHELL_CONTENT_SURFACE_CLASS, contentClassName)}
            >
              {children}
            </div>
          ) : (
            children
          )}
        </motion.div>
      </div>
      {overlay}
    </div>
  );
}
