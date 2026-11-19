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

import {
  APP_SHELL_COLUMN_GAP_PX,
  APP_SHELL_RAIL_WIDTH_PX,
  APP_SHELL_SIDEBAR_TAB_INSET_PX,
  APP_SHELL_SIDEBAR_WIDTH_PX,
} from '@/components/Layout/AppShellLayout';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface TopBarPrimaryNavigationProps {
  sidebarHidden: boolean;
  /** Space reserved before top-bar controls (traffic lights or app padding). */
  leadingInset: number;
  sidebarControls: ReactNode;
  contentControls: ReactNode;
}

/**
 * Width of the top-bar span above the rail and sidebar, after the leading
 * inset. Open, it ends at the sidebar edge; folded, at the rail edge. The
 * macOS traffic lights are wider than the rail, so a folded span can be 0.
 */
export function getTopBarSidebarControlsWidth(
  sidebarHidden: boolean,
  leadingInset: number
): number {
  const shellSpan =
    APP_SHELL_RAIL_WIDTH_PX + (sidebarHidden ? 0 : APP_SHELL_SIDEBAR_WIDTH_PX);
  return Math.max(0, shellSpan - leadingInset);
}

/**
 * Aligns global navigation to the shell grid below it. Expanded: sidebar
 * controls end at the sidebar edge and content controls begin at the content
 * edge. Collapsed: the span covers only the rail, and grows past it when its
 * controls need more room.
 */
export function TopBarPrimaryNavigation({
  sidebarHidden,
  leadingInset,
  sidebarControls,
  contentControls,
}: TopBarPrimaryNavigationProps) {
  const sidebarControlsWidth = getTopBarSidebarControlsWidth(
    sidebarHidden,
    leadingInset
  );

  return (
    <div className="no-drag relative z-50 flex min-w-0 items-center">
      <div
        data-topbar-sidebar-controls
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          !sidebarHidden && 'box-border justify-between'
        )}
        style={
          sidebarHidden
            ? sidebarControlsWidth > 0
              ? { minWidth: sidebarControlsWidth }
              : undefined
            : {
                width: sidebarControlsWidth,
                paddingRight: APP_SHELL_SIDEBAR_TAB_INSET_PX,
              }
        }
      >
        {sidebarControls}
      </div>
      <div
        data-topbar-content-controls
        className="relative flex min-w-0 items-center"
        style={{ marginLeft: APP_SHELL_COLUMN_GAP_PX }}
      >
        <span
          data-topbar-primary-divider
          aria-hidden
          className="pointer-events-none absolute top-1/2 -left-px h-5 w-px -translate-y-1/2 bg-ds-border-neutral-subtle-default"
        />
        {contentControls}
      </div>
    </div>
  );
}
