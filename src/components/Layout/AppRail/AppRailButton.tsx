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

import { SidebarRowTooltip } from '@/components/Layout/AppSidebar/SidebarTooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Rail controls sit on the window-chrome surface, like the top bar, so they
 * share its fill for hover, open, and the selected place.
 */
export const APP_RAIL_CONTROL_STATE_CLASS = [
  'no-drag',
  'hover:!bg-ds-neutral-subtle-default',
  'active:!shadow-ds-elevation-control-pressed',
  'data-[state=open]:!bg-ds-neutral-subtle-default',
  'aria-expanded:!bg-ds-neutral-subtle-default',
].join(' ');

export const APP_RAIL_CONTROL_SELECTED_CLASS = '!bg-ds-neutral-subtle-default';

/** A one-line rail tooltip, as compact as the rail's old ones. */
export const APP_RAIL_TOOLTIP_CLASS = 'py-0';

/**
 * One rail row: a centred control plus the 2px selection bar on the rail's
 * leading edge, so the selected place never rests on fill colour alone.
 */
export function AppRailItem({
  selected = false,
  children,
}: {
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex w-full shrink-0 justify-center">
      {selected ? (
        <span
          aria-hidden
          data-app-rail-selection
          className="pointer-events-none absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-ds-accent-default-default"
        />
      ) : null}
      {children}
    </div>
  );
}

interface AppRailButtonProps {
  label: string;
  /** Tooltip body; defaults to `label`. */
  tooltip?: ReactNode;
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** An icon-only place on the rail (Home, Settings). */
export function AppRailButton({
  label,
  tooltip,
  selected = false,
  onClick,
  children,
}: AppRailButtonProps) {
  return (
    <AppRailItem selected={selected}>
      <SidebarRowTooltip
        content={tooltip ?? label}
        className={APP_RAIL_TOOLTIP_CLASS}
        align="center"
        variant="instant"
      >
        <Button
          type="button"
          variant="ghost"
          size="md"
          buttonContent="icon-only"
          buttonRadius="shell"
          aria-label={label}
          aria-current={selected ? 'page' : undefined}
          className={cn(
            APP_RAIL_CONTROL_STATE_CLASS,
            selected && APP_RAIL_CONTROL_SELECTED_CLASS
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </SidebarRowTooltip>
    </AppRailItem>
  );
}
