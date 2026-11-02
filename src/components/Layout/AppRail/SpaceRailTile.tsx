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

import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  APP_RAIL_CONTROL_SELECTED_CLASS,
  APP_RAIL_CONTROL_STATE_CLASS,
  AppRailItem,
} from './AppRailButton';

/** The letter a Space tile shows until Spaces can carry their own icon. */
export function spaceRailTileInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

interface SpaceRailTileProps {
  name: string;
  /**
   * A pinned Space has a solid tile. The active Space keeps a dashed tile
   * until it is pinned, so the rail always shows where the Space view is.
   */
  pinned?: boolean;
  selected?: boolean;
  onClick: () => void;
}

/** A Space on the rail: a 24px lettered tile inside a 32px control. */
export function SpaceRailTile({
  name,
  pinned = false,
  selected = false,
  onClick,
}: SpaceRailTileProps) {
  return (
    <AppRailItem selected={selected}>
      <TooltipSimple
        content={name}
        compact
        side="right"
        align="center"
        variant="instant"
      >
        <Button
          type="button"
          variant="ghost"
          size="md"
          buttonContent="icon-only"
          aria-label={name}
          aria-current={selected ? 'page' : undefined}
          data-space-rail-tile={pinned ? 'pinned' : 'unpinned'}
          className={cn(
            APP_RAIL_CONTROL_STATE_CLASS,
            selected && APP_RAIL_CONTROL_SELECTED_CLASS
          )}
          onClick={onClick}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-ds-control-xs shrink-0 items-center justify-center rounded-ds-compact-control border border-x border-y',
              pinned
                ? 'border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default'
                : 'border-dashed border-ds-hairline-default-default text-ds-ink-muted-default'
            )}
          >
            <DsText as="span" role="meta" weight="semibold">
              {spaceRailTileInitial(name)}
            </DsText>
          </span>
        </Button>
      </TooltipSimple>
    </AppRailItem>
  );
}
