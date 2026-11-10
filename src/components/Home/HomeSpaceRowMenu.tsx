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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { FolderOpen, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const DESTRUCTIVE_ITEM_CLASS =
  'gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default';

/** The file manager's own name for "show this folder". */
export function useRevealFolderLabel(): string {
  const { t } = useTranslation();
  const platform = useHost()?.electronAPI?.getPlatform?.();
  if (platform === 'darwin') {
    return t('folder.open-in-finder', { defaultValue: 'Open in Finder' });
  }
  if (platform === 'win32') {
    return t('folder.open-in-explorer', {
      defaultValue: 'Open in File Explorer',
    });
  }
  return t('folder.open-in-folder', { defaultValue: 'Open in file manager' });
}

interface HomeSpaceRowMenuProps {
  spaceName: string;
  rootPath: string | null | undefined;
  pinned: boolean;
  /** Archived and the signed-out local Space can't be deleted. */
  canDelete: boolean;
  onTogglePin: () => void;
  onDelete: () => void;
}

/**
 * A Space row's More menu in Home: pin, show its folder, delete. It appears on
 * hover or focus, like a Session row's menu, and stays while open.
 */
export function HomeSpaceRowMenu({
  spaceName,
  rootPath,
  pinned,
  canDelete,
  onTogglePin,
  onDelete,
}: HomeSpaceRowMenuProps) {
  const { t } = useTranslation();
  const host = useHost();
  const [open, setOpen] = useState(false);
  const revealLabel = useRevealFolderLabel();

  const revealFolder = async () => {
    if (!rootPath) return;
    try {
      // The main process opens only paths inside a registered Space root.
      await host?.ipcRenderer?.invoke('set-local-file-preview-roots', [
        rootPath,
      ]);
      const result = await host?.ipcRenderer?.invoke(
        'reveal-local-path',
        rootPath
      );
      if (!result?.success) {
        toast.error(result?.error || t('chat.failed-to-open-folder'));
      }
    } catch (error) {
      console.error(
        '[HomeSpaceRowMenu] Failed to open the Space folder:',
        error
      );
      toast.error(t('chat.failed-to-open-folder'));
    }
  };

  return (
    <div
      className={cn(
        'flex max-w-0 shrink-0 items-center justify-end overflow-hidden opacity-0',
        'pointer-events-none',
        'group-hover/space-row:pointer-events-auto group-hover/space-row:max-w-10 group-hover/space-row:opacity-100',
        'focus-within:pointer-events-auto focus-within:max-w-10 focus-within:opacity-100',
        open && 'pointer-events-auto max-w-10 opacity-100'
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonRadius="full"
            buttonContent="icon-only"
            className="no-drag shrink-0 data-[state=open]:bg-ds-neutral-subtle-selected data-[state=open]:hover:bg-ds-neutral-subtle-selected"
            aria-label={t('layout.space-more-actions', { name: spaceName })}
          >
            <DsIcon
              icon={MoreHorizontal}
              className="text-ds-ink-muted-default"
              aria-hidden
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}>
          <DropdownMenuItem className="gap-2" onSelect={onTogglePin}>
            <DsIcon icon={pinned ? PinOff : Pin} aria-hidden />
            {pinned ? t('layout.unpin-space') : t('layout.pin-space')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={!rootPath}
            onSelect={() => void revealFolder()}
          >
            <DsIcon icon={FolderOpen} aria-hidden />
            {revealLabel}
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={DESTRUCTIVE_ITEM_CLASS}
                onSelect={onDelete}
              >
                <DsIcon icon={Trash2} aria-hidden />
                {t('layout.delete-space')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
