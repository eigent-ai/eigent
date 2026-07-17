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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import type { Space } from '@/store/spaceStore';
import type { TFunction } from 'i18next';
import {
  Check,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type {
  ComponentPropsWithoutRef,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
} from 'react';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';

const SPACE_LIST_ITEM_HEIGHT_CLASS = 'h-8';
const SPACE_LIST_MAX_HEIGHT_CLASS = 'max-h-40';

export interface SpaceSwitchDropdownCreateSpaceMenu {
  onStartFromScratch: () => void | Promise<void>;
  onSelectFolder: () => void | Promise<void>;
}

export interface SpaceSwitchDropdownPendingChangesMenu {
  loading: boolean;
  loadFailed: boolean;
  overlayCount: number;
  action: 'apply' | 'discard' | 'refresh' | null;
  applyProgress: { current: number; total: number } | null;
  applyDisabled: boolean;
  discardDisabled: boolean;
  refreshDisabled: boolean;
  onApply: () => void | Promise<void>;
  onDiscard: () => void;
  onRefresh: () => void | Promise<void>;
}

export interface SpaceSwitchDropdownProps {
  trigger: ReactElement;
  spaces: Space[];
  activeSpaceId: string | null;
  switchingSpaceId: string | null;
  canRenameActiveSpace: boolean;
  createSpaceMenu: SpaceSwitchDropdownCreateSpaceMenu;
  onRenameSpace: () => void;
  onSpaceSelect: (spaceId: string) => void | Promise<void>;
  contentAlign?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  contentClassName?: string;
  contentSideOffset?: number;
  openOnHover?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerWrapperClassName?: string;
  pendingChangesMenu?: SpaceSwitchDropdownPendingChangesMenu;
  /** Tooltip for the trigger (e.g. active space name when the sidebar is folded). */
  triggerTooltip?: ReactNode;
  triggerTooltipEnabled?: boolean;
}

function getSpaceLabel(space: Space, t: TFunction) {
  return getActiveSpaceTriggerLabel(space.name, t);
}

export function SpaceSwitchDropdown({
  trigger,
  spaces,
  activeSpaceId,
  switchingSpaceId,
  canRenameActiveSpace,
  createSpaceMenu,
  onRenameSpace,
  onSpaceSelect,
  contentAlign = 'start',
  contentClassName,
  contentSideOffset,
  openOnHover = false,
  open: controlledOpen,
  onOpenChange,
  triggerWrapperClassName = 'min-w-0 flex-1 overflow-hidden rounded-full',
  pendingChangesMenu,
  triggerTooltip,
  triggerTooltipEnabled = true,
}: SpaceSwitchDropdownProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = controlledOpen ?? internalOpen;
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );

  const navigateToWorkspaceTab = useCallback(() => {
    setActiveWorkspaceTab('workforce');
    requestWorkspaceChatFocus();
  }, [requestWorkspaceChatFocus, setActiveWorkspaceTab]);

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  const openFromHover = useCallback(() => {
    if (!openOnHover) return;
    setOpen(true);
  }, [openOnHover, setOpen]);

  const openFromTriggerInteraction = useCallback(() => {
    if (!openOnHover) return;
    setOpen(true);
  }, [openOnHover, setOpen]);

  const filteredSpaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return spaces;
    return spaces.filter((space) =>
      getSpaceLabel(space, t).toLowerCase().includes(query)
    );
  }, [searchQuery, spaces, t]);

  useEffect(() => {
    if (!open) return;
    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearchQuery('');
    }
    setOpen(nextOpen);
  };

  const hoverOpenTrigger = (() => {
    if (!openOnHover || !isValidElement(trigger)) {
      return trigger;
    }

    const triggerElement = trigger as ReactElement<{
      onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
      onClick?: (event: MouseEvent<HTMLElement>) => void;
    }>;

    return cloneElement(triggerElement, {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        triggerElement.props.onPointerDown?.(event);
        event.preventDefault();
        openFromTriggerInteraction();
      },
      onClick: (event: MouseEvent<HTMLElement>) => {
        triggerElement.props.onClick?.(event);
        openFromTriggerInteraction();
      },
    });
  })();

  const dropdownTrigger = (
    <DropdownMenuTrigger asChild>
      {openOnHover ? hoverOpenTrigger : trigger}
    </DropdownMenuTrigger>
  );

  const triggerWithTooltip =
    triggerTooltip != null && triggerTooltip !== '' ? (
      <TooltipSimple
        content={triggerTooltip}
        side="right"
        align="center"
        enabled={triggerTooltipEnabled}
        className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
      >
        {dropdownTrigger}
      </TooltipSimple>
    ) : (
      dropdownTrigger
    );

  const triggerNode = openOnHover ? (
    <div className={triggerWrapperClassName} onMouseEnter={openFromHover}>
      {triggerWithTooltip}
    </div>
  ) : (
    triggerWithTooltip
  );

  return (
    <DropdownMenu
      modal={!openOnHover}
      open={open}
      onOpenChange={handleOpenChange}
    >
      {triggerNode}
      <DropdownMenuContent
        align={contentAlign}
        sideOffset={contentSideOffset}
        className={cn('p-0 min-w-[280px] overflow-hidden', contentClassName)}
        onMouseEnter={openOnHover ? openFromHover : undefined}
      >
        <div className="gap-1 p-1 flex flex-col">
          <Input
            ref={searchInputRef}
            size="sm"
            value={searchQuery}
            placeholder={t('layout.search-spaces')}
            leadingIcon={
              <Search className="h-4 w-4 text-ds-icon-neutral-muted-default" />
            }
            className="w-full"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />

          <div
            className={cn(
              'scrollbar-always-visible overflow-y-auto',
              SPACE_LIST_MAX_HEIGHT_CLASS
            )}
          >
            {filteredSpaces.length === 0 ? (
              <div className="px-2 py-3 text-body-sm text-ds-text-neutral-muted-default text-center">
                {t('layout.search-no-results')}
              </div>
            ) : (
              filteredSpaces.map((space) => (
                <DropdownMenuItem
                  key={space.id}
                  className={cn('cursor-pointer', SPACE_LIST_ITEM_HEIGHT_CLASS)}
                  disabled={switchingSpaceId !== null}
                  onClick={() => {
                    navigateToWorkspaceTab();
                    void onSpaceSelect(space.id);
                    setOpen(false);
                  }}
                >
                  {switchingSpaceId === space.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check
                      className={cn(
                        'h-4 w-4',
                        activeSpaceId === space.id ? 'opacity-100' : 'opacity-0'
                      )}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {getSpaceLabel(space, t)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </div>

        <DropdownMenuSeparator className="my-0 bg-ds-border-neutral-default-default" />

        <div className={cn('mb-1 px-1 pt-1')}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 text-ds-text-brand-default-default">
              <Plus
                className="h-4 w-4 text-ds-text-brand-default-default shrink-0"
                aria-hidden
              />
              {t('layout.spaces-create-new-space')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="w-52 p-1"
              sideOffset={6}
              alignOffset={-4}
            >
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onSelect={(event) => {
                  event.preventDefault();
                  navigateToWorkspaceTab();
                  void createSpaceMenu.onStartFromScratch();
                  setOpen(false);
                }}
              >
                <PlusCircle className="h-4 w-4 shrink-0" aria-hidden />
                {t('layout.workspace-start-from-scratch')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onSelect={(event) => {
                  event.preventDefault();
                  navigateToWorkspaceTab();
                  void createSpaceMenu.onSelectFolder();
                  setOpen(false);
                }}
              >
                <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
                {t('layout.workspace-use-local-folder')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {pendingChangesMenu ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                {pendingChangesMenu.loading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin shrink-0"
                    aria-hidden
                  />
                ) : pendingChangesMenu.loadFailed ? (
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {t('layout.workspace-pending-changes')}
                {pendingChangesMenu.overlayCount > 0
                  ? ` (${pendingChangesMenu.overlayCount})`
                  : ''}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="w-52 p-1"
                sideOffset={6}
                alignOffset={-4}
              >
                {pendingChangesMenu.loadFailed ? (
                  <div className="gap-2 px-2 py-2 text-body-sm text-ds-text-neutral-muted-default flex items-start">
                    <TriangleAlert
                      className="mt-0.5 h-4 w-4 text-ds-icon-warning-default-default shrink-0"
                      aria-hidden
                    />
                    <span>{t('layout.workspace-pending-load-stale')}</span>
                  </div>
                ) : null}
                <DropdownMenuItem
                  className="gap-2 cursor-pointer"
                  disabled={pendingChangesMenu.applyDisabled}
                  onSelect={(event) => {
                    event.preventDefault();
                    void pendingChangesMenu.onApply();
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  {pendingChangesMenu.applyProgress
                    ? t('layout.workspace-apply-progress', {
                        current: pendingChangesMenu.applyProgress.current,
                        total: pendingChangesMenu.applyProgress.total,
                      })
                    : t('layout.workspace-apply-pending-changes')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 cursor-pointer"
                  disabled={pendingChangesMenu.discardDisabled}
                  onSelect={(event) => {
                    event.preventDefault();
                    pendingChangesMenu.onDiscard();
                  }}
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  {t('layout.workspace-discard-pending-changes')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 cursor-pointer"
                  disabled={pendingChangesMenu.refreshDisabled}
                  onSelect={(event) => {
                    event.preventDefault();
                    void pendingChangesMenu.onRefresh();
                  }}
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                  {t('layout.workspace-refresh-workdir')}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          <DropdownMenuItem
            className="cursor-pointer"
            disabled={!canRenameActiveSpace}
            onClick={() => {
              setOpen(false);
              onRenameSpace();
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            <span>{t('layout.spaces-rename-space')}</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
