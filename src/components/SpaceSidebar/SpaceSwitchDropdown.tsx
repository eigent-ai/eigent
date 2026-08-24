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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import { TooltipSimple } from '@/components/ui/tooltip';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import type { Space } from '@/store/spaceStore';
import type { TFunction } from 'i18next';
import {
  Brain,
  Check,
  CheckCircle2,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
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

import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from '@/components/Layout/AppSidebar';

const SPACE_LIST_ITEM_HEIGHT_CLASS = 'h-8';
const SPACE_LIST_MAX_HEIGHT_CLASS = 'max-h-40';

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

export interface SpaceSwitchDropdownSavePointMenu {
  loading: boolean;
  saving: boolean;
  enabled: boolean;
  needsAttention: boolean;
  pendingCount: number;
  pendingTruncated: boolean;
  onEnable: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onOpenHistory?: () => void;
}

export interface SpaceSwitchDropdownProps {
  trigger: ReactElement;
  spaces: Space[];
  activeSpaceId: string | null;
  switchingSpaceId: string | null;
  canRenameActiveSpace: boolean;
  onOpenCreateSpace: () => void;
  onRenameSpace: () => void;
  onOpenSpaceSettings?: () => void;
  onOpenMemorySettings?: () => void;
  onSpaceSelect: (spaceId: string) => void | Promise<void>;
  contentAlign?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  contentClassName?: string;
  contentSideOffset?: number;
  openOnHover?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerWrapperClassName?: string;
  pendingChangesMenu?: SpaceSwitchDropdownPendingChangesMenu;
  savePointMenu?: SpaceSwitchDropdownSavePointMenu;
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
  onOpenCreateSpace,
  onRenameSpace,
  onOpenSpaceSettings,
  onOpenMemorySettings,
  onSpaceSelect,
  contentAlign = 'start',
  contentClassName,
  contentSideOffset,
  openOnHover = false,
  open: controlledOpen,
  onOpenChange,
  triggerWrapperClassName = 'min-w-0 flex-1 overflow-hidden rounded-full',
  pendingChangesMenu,
  savePointMenu,
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
        variant="instant"
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
        className={cn('min-w-[280px] overflow-hidden', contentClassName)}
        onMouseEnter={openOnHover ? openFromHover : undefined}
      >
        <div className="flex flex-col gap-1">
          <Input
            ref={searchInputRef}
            size="sm"
            value={searchQuery}
            placeholder={t('layout.search-spaces')}
            leadingIcon={
              <Search className="h-4 w-4 text-ds-ink-muted-default" />
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
              <div className="px-2 py-3 text-center text-ds-text-base text-ds-ink-muted-default">
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
                  <span className="min-w-0 flex-1 truncate">
                    {getSpaceLabel(space, t)}
                  </span>
                  {switchingSpaceId === space.id ? (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : activeSpaceId === space.id ? (
                    <Check
                      className="h-4 w-4 shrink-0 text-ds-accent-default-default"
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
            onOpenCreateSpace();
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t('layout.spaces-create-new-space')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="truncate px-2 py-1.5 font-normal text-ds-ink-muted-default">
          <span className="text-ds-text-meta font-medium">
            {t('layout.spaces-current-space')}
          </span>
        </DropdownMenuLabel>

        {pendingChangesMenu ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              {pendingChangesMenu.loading ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin"
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
                <div className="flex items-start gap-2 px-2 py-2 text-ds-text-base text-ds-ink-muted-default">
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-warning-default-default"
                    aria-hidden
                  />
                  <span>{t('layout.workspace-pending-load-stale')}</span>
                </div>
              ) : null}
              <DropdownMenuItem
                className="cursor-pointer gap-2"
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
                className="cursor-pointer gap-2"
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
                className="cursor-pointer gap-2"
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

        {savePointMenu ? (
          <>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              disabled={
                savePointMenu.loading ||
                savePointMenu.saving ||
                savePointMenu.needsAttention ||
                (savePointMenu.enabled && savePointMenu.pendingCount === 0)
              }
              onSelect={(event) => {
                event.preventDefault();
                if (savePointMenu.enabled) {
                  void savePointMenu.onSave();
                } else {
                  void savePointMenu.onEnable();
                }
              }}
            >
              {savePointMenu.loading || savePointMenu.saving ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin"
                  aria-hidden
                />
              ) : savePointMenu.needsAttention ? (
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Save className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">
                {savePointMenu.loading
                  ? t('layout.workspace-version-loading')
                  : savePointMenu.saving
                    ? t('layout.workspace-save-point-saving')
                    : savePointMenu.needsAttention
                      ? t('layout.workspace-version-needs-attention')
                      : savePointMenu.enabled
                        ? t('layout.workspace-save-point', {
                            count: savePointMenu.pendingCount,
                            suffix: savePointMenu.pendingTruncated ? '+' : '',
                          })
                        : t('layout.workspace-enable-version-history')}
              </span>
              {savePointMenu.enabled ? (
                <ShortcutKeycap aria-hidden>
                  {navigator.platform.toLowerCase().includes('mac')
                    ? '⌘S'
                    : 'Ctrl+S'}
                </ShortcutKeycap>
              ) : null}
            </DropdownMenuItem>
            {savePointMenu.enabled && savePointMenu.onOpenHistory ? (
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onSelect={() => {
                  setOpen(false);
                  savePointMenu.onOpenHistory?.();
                }}
              >
                <GitBranch className="h-4 w-4 shrink-0" aria-hidden />
                {t('layout.workspace-version-history', {
                  defaultValue: 'Version history',
                })}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}

        {savePointMenu &&
        (canRenameActiveSpace ||
          onOpenSpaceSettings ||
          onOpenMemorySettings) ? (
          <DropdownMenuSeparator
            className="mx-2"
            data-space-settings-separator
          />
        ) : null}

        <DropdownMenuItem
          disabled={!canRenameActiveSpace}
          onClick={() => {
            setOpen(false);
            onRenameSpace();
          }}
        >
          <Pencil className="h-4 w-4" aria-hidden />
          <span>{t('layout.spaces-rename-space')}</span>
        </DropdownMenuItem>

        {onOpenSpaceSettings ? (
          <DropdownMenuItem
            className="gap-2"
            disabled={!activeSpaceId}
            onSelect={() => {
              setOpen(false);
              onOpenSpaceSettings();
            }}
          >
            <Settings className="h-4 w-4" aria-hidden />
            <span>
              {t('layout.space-settings', { defaultValue: 'Space settings' })}
            </span>
          </DropdownMenuItem>
        ) : null}

        {onOpenMemorySettings ? (
          <DropdownMenuItem
            className="gap-2"
            disabled={!activeSpaceId}
            onSelect={() => {
              setOpen(false);
              onOpenMemorySettings();
            }}
          >
            <Brain className="h-4 w-4" aria-hidden />
            <span>
              {t('setting.memory-settings', {
                defaultValue: 'Memory settings',
              })}
            </span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
