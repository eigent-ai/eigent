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
  FOOTER_COMPACT_TRIGGER_CLASS,
  useFooterCompact,
} from '@/components/ChatBox/BottomBox/footerCompact';
import { getChoosableSpaces } from '@/components/Layout/AppRail/pinnedSpaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { Input } from '@/components/ui/input';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { WorkspaceTab } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  Check,
  ChevronDown,
  Folder,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';
import NewSpaceDialog from './NewSpaceDialog';

/**
 * Footer controls share one trigger shell (`ApprovalModeSelect`): a rounded
 * fill with an icon, a meta-size label and a chevron.
 */
const FOOTER_TRIGGER_CLASS = cn(
  'inline-flex max-w-[min(100%,320px)] min-w-0 shrink items-center justify-between gap-1.5 rounded-xl px-2 py-1',
  'bg-ds-neutral-subtle-default text-ds-ink-default-default',
  'cursor-pointer border-0 border-x-0 border-y-0 text-left font-semibold transition-colors',
  'hover:bg-ds-neutral-default-default active:shadow-ds-elevation-control-pressed data-[state=open]:bg-ds-neutral-default-default',
  'focus-visible:ring-2 focus-visible:ring-ds-hairline-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-neutral-subtle-default focus-visible:outline-none',
  'disabled:pointer-events-none disabled:opacity-50'
);

/**
 * The Space picker in Home's New session composer: the Space the Session will
 * start in, which also sets its folder and file previews. It starts on the
 * active Space, the one worked in last, and lists Spaces like the old top-bar
 * switcher: search, a scrolling list, then New Space.
 */
export function NewSessionSpaceChip() {
  const { t } = useTranslation();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const { switchToSpace, switchingSpaceId } = useSpaceSwitch();
  // In a narrow composer footer the chip becomes a folder icon button.
  const compact = useFooterCompact();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } =
    useNewSpaceCreation('home_hub');

  const choosableSpaces = useMemo(
    () => getChoosableSpaces(spaces, projectsBySpaceId, activeSpaceId),
    [activeSpaceId, projectsBySpaceId, spaces]
  );
  const filteredSpaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choosableSpaces;
    return choosableSpaces.filter((space) =>
      getActiveSpaceTriggerLabel(space.name, t).toLowerCase().includes(needle)
    );
  }, [choosableSpaces, query, t]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const activeSpace = activeSpaceId ? spaces[activeSpaceId] : undefined;
  const label = activeSpace
    ? getActiveSpaceTriggerLabel(activeSpace.name, t)
    : t('layout.spaces-select-space');
  const fieldLabel = t('layout.new-session-space');

  const chooseSpace = (spaceId: string) => {
    setOpen(false);
    if (spaceId === activeSpaceId) return;
    void switchToSpace(spaceId, {
      project: null,
      tab: WorkspaceTab.NewProject,
    });
  };

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (!next) setQuery('');
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={switchingSpaceId !== null}
            title={label}
            aria-label={`${fieldLabel}, ${label}`}
            aria-haspopup="menu"
            data-new-session-space-chip
            className={cn(
              FOOTER_TRIGGER_CLASS,
              compact && cn('shrink-0', FOOTER_COMPACT_TRIGGER_CLASS)
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <DsIcon icon={Folder} className="opacity-80" />
              {!compact && (
                <span className="min-w-0 flex-1 truncate text-left !text-ds-text-meta text-ds-ink-default-default">
                  {label}
                </span>
              )}
            </span>
            {!compact && <DsIcon icon={ChevronDown} className="opacity-80" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={4}
          collisionPadding={12}
          avoidCollisions
          className="w-[280px] overflow-hidden"
        >
          <div className="flex flex-col gap-1">
            <Input
              ref={searchRef}
              size="sm"
              value={query}
              placeholder={t('layout.search-spaces')}
              aria-label={t('layout.search-spaces')}
              leadingIcon={
                <DsIcon icon={Search} className="text-ds-ink-muted-default" />
              }
              className="w-full"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // ArrowDown moves into the list; Escape and Tab keep the
                // menu's own handling.
                if (event.key === 'ArrowDown') {
                  const first = listRef.current?.querySelector<HTMLElement>(
                    '[role="menuitem"]:not([data-disabled])'
                  );
                  if (first) {
                    event.preventDefault();
                    event.stopPropagation();
                    first.focus();
                  }
                  return;
                }
                if (event.key === 'Escape' || event.key === 'Tab') return;
                // Keep typing in the field instead of the menu's typeahead.
                event.stopPropagation();
              }}
            />
            <div
              ref={listRef}
              data-new-session-space-list
              className="scrollbar-always-visible max-h-60 overflow-y-auto"
            >
              {filteredSpaces.length === 0 ? (
                <div className="px-2 py-3 text-center text-ds-text-base text-ds-ink-muted-default">
                  {t('layout.search-no-results')}
                </div>
              ) : (
                filteredSpaces.map((space) => (
                  <DropdownMenuItem
                    key={space.id}
                    className="h-8 cursor-pointer gap-2"
                    disabled={switchingSpaceId !== null}
                    onSelect={() => chooseSpace(space.id)}
                  >
                    <DsIcon
                      icon={Folder}
                      className="shrink-0 text-ds-ink-muted-default"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {getActiveSpaceTriggerLabel(space.name, t)}
                    </span>
                    {switchingSpaceId === space.id ? (
                      <DsIcon
                        icon={Loader2}
                        className="shrink-0 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : activeSpaceId === space.id ? (
                      <DsIcon
                        icon={Check}
                        className="shrink-0 text-ds-accent-default-default"
                        aria-hidden
                      />
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              setOpen(false);
              setNewSpaceDialogOpen(true);
            }}
          >
            <DsIcon icon={Plus} aria-hidden />
            {t('layout.spaces-create-new-space')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={createBlankSpace}
        onUseLocalFolder={createSpaceFromFolder}
      />
    </>
  );
}
