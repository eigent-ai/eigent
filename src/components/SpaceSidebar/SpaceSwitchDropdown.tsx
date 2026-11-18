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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import { cn } from '@/lib/utils';
import {
  Brain,
  GitBranch,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Save,
  Settings,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESTRUCTIVE_MENU_ITEM_CLASS } from './constants';

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
  /** Delete Space; the caller confirms first. */
  onDeleteSpace?: () => void;
  contentAlign?: ComponentPropsWithoutRef<typeof DropdownMenuContent>['align'];
  contentClassName?: string;
  contentSideOffset?: number;
  onOpenChange?: (open: boolean) => void;
  savePointMenu?: SpaceSwitchDropdownSavePointMenu;
}

/**
 * The Space menu behind the Space's name, in the Workspace page's title and
 * at the top of the Space sidebar: actions for that Space. Switching Spaces
 * happens on the rail and in Home, so it lists no Spaces.
 */
export function SpaceSwitchDropdown({
  trigger,
  activeSpaceId,
  canRenameActiveSpace,
  onRenameSpace,
  onOpenSpaceSettings,
  onOpenMemorySettings,
  pinMenu,
  onDeleteSpace,
  contentAlign = 'start',
  contentClassName,
  contentSideOffset,
  onOpenChange,
  savePointMenu,
}: SpaceSwitchDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState(false);

  const setOpen = (nextOpen: boolean) => {
    setOpenState(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={contentAlign}
        sideOffset={contentSideOffset}
        className={cn('min-w-60 overflow-hidden', contentClassName)}
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

        {pinMenu ? (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              setOpen(false);
              pinMenu.onToggle();
            }}
          >
            <DsIcon icon={pinMenu.pinned ? PinOff : Pin} aria-hidden />
            <span>
              {pinMenu.pinned ? t('layout.unpin-space') : t('layout.pin-space')}
            </span>
          </DropdownMenuItem>
        ) : null}

        {onDeleteSpace ? (
          <DropdownMenuItem
            className={DESTRUCTIVE_MENU_ITEM_CLASS}
            onSelect={() => {
              setOpen(false);
              onDeleteSpace();
            }}
          >
            <DsIcon icon={Trash2} aria-hidden />
            <span>{t('layout.delete-space')}</span>
          </DropdownMenuItem>
        ) : null}

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

        {savePointMenu ? (
          <DropdownMenuSeparator
            className="mx-2"
            data-space-settings-separator
          />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
