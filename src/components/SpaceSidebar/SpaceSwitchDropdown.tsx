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
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Brain,
  CheckCircle2,
  GitBranch,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Save,
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
import { cloneElement, isValidElement, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from '@/components/Layout/AppSidebar';

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

export interface SpaceSwitchDropdownPinMenu {
  pinned: boolean;
  onToggle: () => void;
}

export interface SpaceSwitchDropdownProps {
  trigger: ReactElement;
  activeSpaceId: string | null;
  canRenameActiveSpace: boolean;
  onRenameSpace: () => void;
  onOpenSpaceSettings?: () => void;
  onOpenMemorySettings?: () => void;
  /** Pin Space / Unpin Space for the active Space. */
  pinMenu?: SpaceSwitchDropdownPinMenu;
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

/**
 * The Space menu behind the top-bar Space name: actions for the active Space.
 * Switching Spaces happens on the rail and in Home, so it lists no Spaces.
 */
export function SpaceSwitchDropdown({
  trigger,
  activeSpaceId,
  canRenameActiveSpace,
  onRenameSpace,
  onOpenSpaceSettings,
  onOpenMemorySettings,
  pinMenu,
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
  const open = controlledOpen ?? internalOpen;

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

  const handleOpenChange = (nextOpen: boolean) => {
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
        className={cn('min-w-[240px] overflow-hidden', contentClassName)}
        onMouseEnter={openOnHover ? openFromHover : undefined}
      >
        <DropdownMenuItem
          disabled={!canRenameActiveSpace}
          onClick={() => {
            setOpen(false);
            onRenameSpace();
          }}
        >
          <DsIcon icon={Pencil} aria-hidden />
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
            <DsIcon icon={Settings} aria-hidden />
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
            <DsIcon icon={Brain} aria-hidden />
            <span>
              {t('setting.memory-settings', {
                defaultValue: 'Memory settings',
              })}
            </span>
          </DropdownMenuItem>
        ) : null}

        {pendingChangesMenu || savePointMenu ? (
          <DropdownMenuSeparator
            className="mx-2"
            data-space-settings-separator
          />
        ) : null}

        {pendingChangesMenu ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              {pendingChangesMenu.loading ? (
                <DsIcon
                  icon={Loader2}
                  className="shrink-0 animate-spin"
                  aria-hidden
                />
              ) : pendingChangesMenu.loadFailed ? (
                <DsIcon icon={TriangleAlert} className="shrink-0" aria-hidden />
              ) : (
                <DsIcon icon={CheckCircle2} className="shrink-0" aria-hidden />
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
                  <DsIcon
                    icon={TriangleAlert}
                    className="mt-0.5 shrink-0 text-ds-icon-warning-default-default"
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
                <DsIcon icon={CheckCircle2} className="shrink-0" aria-hidden />
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
                <DsIcon icon={Trash2} className="shrink-0" aria-hidden />
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
                <DsIcon icon={RefreshCw} className="shrink-0" aria-hidden />
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
                <DsIcon
                  icon={Loader2}
                  className="shrink-0 animate-spin"
                  aria-hidden
                />
              ) : savePointMenu.needsAttention ? (
                <DsIcon icon={TriangleAlert} className="shrink-0" aria-hidden />
              ) : (
                <DsIcon icon={Save} className="shrink-0" aria-hidden />
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
                <DsIcon icon={GitBranch} className="shrink-0" aria-hidden />
                {t('layout.workspace-version-history', {
                  defaultValue: 'Version history',
                })}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}

        {pinMenu ? (
          <>
            <DropdownMenuSeparator className="mx-2" />
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => {
                setOpen(false);
                pinMenu.onToggle();
              }}
            >
              <DsIcon icon={pinMenu.pinned ? PinOff : Pin} aria-hidden />
              <span>
                {pinMenu.pinned
                  ? t('layout.unpin-space')
                  : t('layout.pin-space')}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
