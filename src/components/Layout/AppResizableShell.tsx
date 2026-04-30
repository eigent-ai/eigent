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

import { PROJECT_SIDEBAR_FOLD_SPRING } from '@/components/PageSidebar/constants';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useShellSidebarLayout } from '@/hooks/useShellSidebarLayout';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const DEFAULT_SIDEBAR_PCT = 24;

type AppResizableShellProps = {
  sidebarWidthStorageKey: string;
  panelGroupId: string;
  sidebar: ReactNode;
  main: ReactNode;
  /** spring on main column */
  layoutSpring?: typeof PROJECT_SIDEBAR_FOLD_SPRING;
  /** Width % for left panel default (react-resizable-panels) */
  sidebarDefaultSize?: number;
  /**
   * Classes on the framer-motion wrapper around `main` (Home: gap-4 + overflow;
   * History: scroll surface + rounded).
   */
  mainMotionClassName: string;
  /** History: outer shell is transparent so the app backdrop shows through. Home: filled shell. */
  transparentShell?: boolean;
  /** Optional extra class on outer shell */
  shellClassName?: string;
};

export function AppResizableShell({
  sidebarWidthStorageKey,
  panelGroupId,
  sidebar,
  main,
  layoutSpring = PROJECT_SIDEBAR_FOLD_SPRING,
  sidebarDefaultSize = DEFAULT_SIDEBAR_PCT,
  mainMotionClassName,
  transparentShell = false,
  shellClassName,
}: AppResizableShellProps) {
  const {
    shellPanelGroupRef,
    shellPanelGroupImperativeRef,
    projectSidebarPanelRef,
    sidebarPct,
    mainPanelPct,
    mainPanelMaxSize,
    handleShellPanelLayout,
  } = useShellSidebarLayout(sidebarWidthStorageKey);

  return (
    <div
      ref={shellPanelGroupRef}
      className={cn(
        'min-h-0 min-w-0 rounded-2xl h-full w-full flex-1',
        transparentShell
          ? 'bg-transparent'
          : 'bg-ds-bg-neutral-default-default',
        shellClassName
      )}
    >
      <ResizablePanelGroup
        ref={shellPanelGroupImperativeRef}
        id={panelGroupId}
        direction="horizontal"
        className="min-h-0 gap-0 h-full w-full"
        onLayout={handleShellPanelLayout}
      >
        <ResizablePanel
          ref={projectSidebarPanelRef}
          defaultSize={sidebarDefaultSize}
          minSize={sidebarPct.rail}
          maxSize={sidebarPct.max}
          className="min-h-0 min-w-0 pl-1"
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            'w-1 after:bg-ds-bg-neutral-default-default shrink-0 bg-transparent after:transition-colors',
            'hover:after:bg-ds-bg-brand-default-focus transition-colors',
            'data-[resize-handle-state=drag]:after:bg-ds-bg-brand-default-focus'
          )}
        />
        <ResizablePanel
          defaultSize={100 - sidebarDefaultSize}
          minSize={mainPanelPct.min}
          maxSize={mainPanelMaxSize}
          className="min-h-0 min-w-[300px]"
        >
          <motion.div
            layout
            transition={{ layout: layoutSpring }}
            className={mainMotionClassName}
          >
            {main}
          </motion.div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
