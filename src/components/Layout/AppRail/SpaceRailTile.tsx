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
import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import type { SpaceAttention } from '@/hooks/useSpaceAttention';
import { cn } from '@/lib/utils';
import type { TFunction } from 'i18next';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  APP_RAIL_CONTROL_SELECTED_CLASS,
  APP_RAIL_CONTROL_STATE_CLASS,
  APP_RAIL_TOOLTIP_CLASS,
  AppRailItem,
} from './AppRailButton';

/** "1 waiting for your reply, 2 running", or nothing while the Space is idle. */
export function spaceRailStatusText(
  attention: SpaceAttention | null | undefined,
  t: TFunction
): string {
  const parts: string[] = [];
  if (attention?.waiting) {
    parts.push(t('layout.space-status-waiting', { count: attention.waiting }));
  }
  if (attention?.running) {
    parts.push(t('layout.space-status-running', { count: attention.running }));
  }
  return parts.join(', ');
}

interface SpaceRailTileProps {
  name: string;
  /** Chosen emoji; without one the tile shows the name's first letter. */
  emoji?: string | null;
  /**
   * A pinned Space has a solid tile. The active Space keeps a dashed tile
   * until it is pinned, so the rail always shows where the Space view is.
   */
  pinned?: boolean;
  selected?: boolean;
  attention?: SpaceAttention | null;
  /** Shortcut catalog id shown in the tooltip, for pinned Spaces. */
  shortcutId?: string;
  /** Items for the right-click menu. */
  menu?: ReactNode;
  onClick: () => void;
}

/** A Space on the rail: a 24px lettered tile inside a 32px control. */
export function SpaceRailTile({
  name,
  emoji = null,
  pinned = false,
  selected = false,
  attention,
  shortcutId,
  menu,
  onClick,
}: SpaceRailTileProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const status = attention?.waiting
    ? 'waiting'
    : attention?.running
      ? 'running'
      : null;
  const statusText = spaceRailStatusText(attention, t);
  const accessibleName = statusText ? `${name}, ${statusText}` : name;

  const openMenu = (event: MouseEvent | KeyboardEvent) => {
    if (!menu) return;
    event.preventDefault();
    setMenuOpen(true);
  };

  const tile = (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="md"
      buttonContent="icon-only"
      buttonRadius="shell"
      aria-label={accessibleName}
      aria-current={selected ? 'page' : undefined}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? menuOpen : undefined}
      data-space-rail-tile={pinned ? 'pinned' : 'unpinned'}
      className={cn(
        'group/space-tile',
        APP_RAIL_CONTROL_STATE_CLASS,
        selected && APP_RAIL_CONTROL_SELECTED_CLASS
      )}
      onClick={onClick}
      onContextMenu={openMenu}
      onKeyDown={(event) => {
        if (
          event.key === 'ContextMenu' ||
          (event.key === 'F10' && event.shiftKey)
        ) {
          openMenu(event);
        }
      }}
    >
      <span
        aria-hidden
        className={cn(
          'relative flex size-ds-control-xs shrink-0 items-center justify-center rounded-ds-compact-control border border-x border-y',
          pinned
            ? 'border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default'
            : 'border-dashed border-ds-hairline-default-default text-ds-ink-muted-default'
        )}
      >
        <SpaceGlyph name={name} emoji={emoji} />
        {status ? (
          <span
            data-space-rail-status={status}
            className={cn(
              // The 2px ring cuts the mark out of the surface behind it.
              'absolute -top-1 -right-1 size-2 rounded-full ring-2 ring-ds-neutral-strong-default',
              'group-hover/space-tile:ring-ds-neutral-subtle-default',
              selected && 'ring-ds-neutral-subtle-default',
              status === 'waiting'
                ? 'bg-ds-text-status-error-strong-default'
                : 'border border-x border-y border-solid border-ds-border-information-default-default bg-ds-neutral-strong-default',
              status === 'running' &&
                (selected
                  ? 'bg-ds-neutral-subtle-default'
                  : 'group-hover/space-tile:bg-ds-neutral-subtle-default')
            )}
          />
        ) : null}
      </span>
    </Button>
  );

  return (
    <AppRailItem selected={selected}>
      <SidebarRowTooltip
        content={
          <ShortcutTooltipContent
            label={name}
            description={statusText || undefined}
            shortcutId={shortcutId}
          />
        }
        className={statusText ? undefined : APP_RAIL_TOOLTIP_CLASS}
        align="center"
        variant="instant"
        enabled={!menuOpen}
      >
        {tile}
      </SidebarRowTooltip>
      {menu ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none absolute inset-0"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // An item may have moved focus on purpose, for example into
              // the pin chooser; return to the tile only when it didn't.
              const focused = document.activeElement;
              if (focused && focused !== document.body) return;
              buttonRef.current?.focus();
            }}
          >
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </AppRailItem>
  );
}
