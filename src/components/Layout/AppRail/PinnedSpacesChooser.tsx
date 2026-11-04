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

import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { spaceEmoji } from '@/lib/spaceEmoji';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import {
  MAX_PINNED_SPACES,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  APP_RAIL_CONTROL_SELECTED_CLASS,
  APP_RAIL_CONTROL_STATE_CLASS,
  AppRailItem,
} from './AppRailButton';
import {
  getChoosableSpaces,
  usePinnedSpaceIds,
  usePinnedSpacesChooser,
} from './pinnedSpaces';

const ROW_CLASS =
  'flex min-h-ds-control-lg min-w-0 items-center gap-ds-8 rounded-ds-menu-row px-ds-8';

function SpaceInitial({ space, name }: { space: Space; name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-ds-control-xs shrink-0 items-center justify-center rounded-ds-compact-control border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default text-ds-ink-default-default"
    >
      <SpaceGlyph name={name} emoji={spaceEmoji(space)} />
    </span>
  );
}

function ChooserRowLabel({
  space,
  name,
  checked,
  disabled,
  activeSpaceId,
  onCheckedChange,
}: {
  space: Space;
  name: string;
  checked: boolean;
  disabled: boolean;
  activeSpaceId: string | null;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const checkboxId = useId();
  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        ROW_CLASS,
        'flex-1 cursor-pointer hover:bg-ds-neutral-default-hover',
        disabled && 'cursor-not-allowed hover:bg-transparent'
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <SpaceInitial space={space} name={name} />
      <DsText
        as="span"
        role="base"
        className={cn(
          'min-w-0 flex-1 truncate',
          disabled ? 'text-ds-ink-muted-default' : 'text-ds-ink-default-default'
        )}
        title={name}
      >
        {name}
      </DsText>
      {space.id === activeSpaceId ? (
        <DsText as="span" role="meta" className="text-ds-ink-muted-default">
          {t('layout.pinned-spaces-active')}
        </DsText>
      ) : null}
    </label>
  );
}

function PinnedChooserRow({
  space,
  name,
  index,
  count,
  activeSpaceId,
  instructionsId,
  dragging,
  onDraggingChange,
  onUnpin,
  onMove,
}: {
  space: Space;
  name: string;
  index: number;
  count: number;
  activeSpaceId: string | null;
  instructionsId: string;
  dragging: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onUnpin: () => void;
  onMove: (toIndex: number) => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();
  return (
    <Reorder.Item
      as="li"
      value={space.id}
      dragListener={false}
      dragControls={controls}
      layout={reduceMotion ? undefined : 'position'}
      transition={reduceMotion ? { duration: 0 } : undefined}
      onDragStart={() => onDraggingChange(true)}
      onDragEnd={() => onDraggingChange(false)}
      data-pinned-space-row={space.id}
      className={cn(
        'flex min-w-0 items-center rounded-ds-menu-row',
        dragging && 'bg-ds-neutral-default-default shadow-ds-elevation-drag'
      )}
    >
      <ChooserRowLabel
        space={space}
        name={name}
        checked
        disabled={false}
        activeSpaceId={activeSpaceId}
        onCheckedChange={(checked) => {
          if (!checked) onUnpin();
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        aria-label={t('layout.pinned-space-move', {
          name,
          position: index + 1,
          count,
        })}
        aria-describedby={instructionsId}
        onPointerDown={(event) => controls.start(event)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault();
            onMove(index - 1);
          } else if (event.key === 'ArrowDown' && index < count - 1) {
            event.preventDefault();
            onMove(index + 1);
          }
        }}
      >
        <DsIcon icon={GripVertical} recipe="main-compact" aria-hidden />
      </Button>
    </Reorder.Item>
  );
}

/**
 * "Choose pinned Spaces": every Space with a checkbox, pins first in their
 * order. Up to 5 can be ticked; the rest are disabled until one is cleared.
 * Choices apply at once.
 */
export function PinnedSpacesChooser() {
  const { t } = useTranslation();
  const open = usePinnedSpacesChooser((state) => state.open);
  const setOpen = usePinnedSpacesChooser((state) => state.setOpen);
  const pinnedIds = usePinnedSpaceIds();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const pinSpace = useSpaceStore((state) => state.pinSpace);
  const unpinSpace = useSpaceStore((state) => state.unpinSpace);
  const moveSpacePin = useSpaceStore((state) => state.moveSpacePin);
  const setPinnedSpaces = useSpaceStore((state) => state.setPinnedSpaces);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const instructionsId = useId();
  const label = t('layout.choose-pinned-spaces');
  const full = pinnedIds.length >= MAX_PINNED_SPACES;

  const unpinnedSpaces = useMemo(() => {
    const pinned = new Set(pinnedIds);
    return getChoosableSpaces(spaces, projectsBySpaceId, activeSpaceId).filter(
      (space) => !pinned.has(space.id)
    );
  }, [activeSpaceId, pinnedIds, projectsBySpaceId, spaces]);

  const nameOf = (space: Space) => getActiveSpaceTriggerLabel(space.name, t);

  const move = (space: Space, toIndex: number) => {
    moveSpacePin(space.id, toIndex);
    setAnnouncement(
      t('layout.pinned-space-moved', {
        name: nameOf(space),
        position: toIndex + 1,
        count: pinnedIds.length,
      })
    );
  };

  return (
    <AppRailItem>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipSimple
          content={label}
          compact
          side="right"
          align="center"
          variant="instant"
          enabled={!open}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="md"
              buttonContent="icon-only"
              aria-label={label}
              className={cn(
                APP_RAIL_CONTROL_STATE_CLASS,
                open && APP_RAIL_CONTROL_SELECTED_CLASS
              )}
            >
              <DsIcon icon={MoreHorizontal} aria-hidden />
            </Button>
          </PopoverTrigger>
        </TooltipSimple>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-72 p-ds-4"
          aria-label={label}
        >
          <div className="flex items-center justify-between gap-ds-8 px-ds-8 py-ds-6">
            <DsText
              as="h2"
              role="base"
              weight="semibold"
              className="text-ds-ink-default-default"
            >
              {t('layout.pinned-spaces')}
            </DsText>
            <DsText
              as="span"
              role="meta"
              className="text-ds-ink-muted-default tabular-nums"
              aria-live="polite"
            >
              {t('layout.pinned-spaces-count', {
                count: pinnedIds.length,
                max: MAX_PINNED_SPACES,
              })}
            </DsText>
          </div>
          <div className="scrollbar-always-visible max-h-80 overflow-y-auto">
            {pinnedIds.length > 0 ? (
              <Reorder.Group
                as="ul"
                axis="y"
                values={pinnedIds}
                onReorder={setPinnedSpaces}
                className="m-0 flex list-none flex-col p-0"
                aria-label={t('layout.pinned-spaces')}
              >
                {pinnedIds.map((spaceId, index) => {
                  const space = spaces[spaceId];
                  if (!space) return null;
                  return (
                    <PinnedChooserRow
                      key={spaceId}
                      space={space}
                      name={nameOf(space)}
                      index={index}
                      count={pinnedIds.length}
                      activeSpaceId={activeSpaceId}
                      instructionsId={instructionsId}
                      dragging={draggingId === spaceId}
                      onDraggingChange={(dragging) =>
                        setDraggingId(dragging ? spaceId : null)
                      }
                      onUnpin={() => unpinSpace(spaceId)}
                      onMove={(toIndex) => move(space, toIndex)}
                    />
                  );
                })}
              </Reorder.Group>
            ) : null}
            {unpinnedSpaces.length > 0 ? (
              <ul
                className="m-0 flex list-none flex-col p-0"
                aria-label={t('layout.other-spaces')}
              >
                {unpinnedSpaces.map((space) => (
                  <li key={space.id} className="flex min-w-0">
                    <ChooserRowLabel
                      space={space}
                      name={nameOf(space)}
                      checked={false}
                      disabled={full}
                      activeSpaceId={activeSpaceId}
                      onCheckedChange={(checked) => {
                        if (checked) pinSpace(space.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DsText
            as="p"
            role="meta"
            id={instructionsId}
            className="m-0 px-ds-8 py-ds-6 text-ds-ink-muted-default"
          >
            {t('layout.pinned-spaces-hint')}
          </DsText>
          <span className="sr-only" aria-live="polite">
            {announcement}
          </span>
        </PopoverContent>
      </Popover>
    </AppRailItem>
  );
}
