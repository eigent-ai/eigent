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
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Pencil,
  Pin,
  PinOff,
  Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SpaceRailTileMenuProps {
  pinned: boolean;
  canRename: boolean;
  /** Position among the pins; only pinned tiles can move. */
  pinIndex: number;
  pinCount: number;
  onOpen: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onOpenSpaceSettings: () => void;
  onMove: (toIndex: number) => void;
}

/** Right-click menu of a Space tile. Move up / down is the keyboard reorder. */
export function SpaceRailTileMenu({
  pinned,
  canRename,
  pinIndex,
  pinCount,
  onOpen,
  onTogglePin,
  onRename,
  onOpenSpaceSettings,
  onMove,
}: SpaceRailTileMenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem onSelect={onOpen}>
        <DsIcon icon={ExternalLink} aria-hidden />
        {t('layout.space-open')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onTogglePin}>
        <DsIcon icon={pinned ? PinOff : Pin} aria-hidden />
        {pinned ? t('layout.unpin-space') : t('layout.pin-space')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!canRename} onSelect={onRename}>
        <DsIcon icon={Pencil} aria-hidden />
        {t('layout.spaces-rename-space')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onOpenSpaceSettings}>
        <DsIcon icon={Settings} aria-hidden />
        {t('layout.space-settings')}
      </DropdownMenuItem>
      {pinned ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pinIndex <= 0}
            onSelect={() => onMove(pinIndex - 1)}
          >
            <DsIcon icon={ArrowUp} aria-hidden />
            {t('layout.move-up')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pinIndex >= pinCount - 1}
            onSelect={() => onMove(pinIndex + 1)}
          >
            <DsIcon icon={ArrowDown} aria-hidden />
            {t('layout.move-down')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}
