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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { SPACE_ICONS, SPACE_ICON_IDS, spaceIconId } from '@/lib/spaceIcons';
import { cn } from '@/lib/utils';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { CaseSensitive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/**
 * The Space's icon on its detail page, beside the title. Clicking it opens
 * the icons to choose from, or goes back to the first letter.
 */
export function SpaceIconPicker({
  space,
  name,
}: {
  space: Space;
  name: string;
}) {
  const { t } = useTranslation();
  const setSpaceIcon = useSpaceStore((state) => state.setSpaceIcon);
  const current = spaceIconId(space);

  const choose = (iconId: string | null) => {
    if (iconId === current) return;
    setSpaceIcon(space.id, iconId).catch((error: unknown) => {
      console.warn('[SpaceIconPicker] Failed to update the icon:', error);
      toast.error(t('layout.space-icon-update-failed'));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('layout.space-icon-change', { name })}
          data-space-icon-picker
          className="flex size-ds-control-xl shrink-0 cursor-pointer items-center justify-center rounded-ds-compact-control border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default transition-colors outline-none hover:bg-ds-neutral-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus data-[state=open]:bg-ds-neutral-muted-default"
        >
          <SpaceGlyph name={name} iconId={current} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[224px]">
        <div className="grid grid-cols-6 gap-ds-2">
          {SPACE_ICON_IDS.map((iconId, index) => (
            <DropdownMenuItem
              key={iconId}
              aria-label={t('layout.space-icon-option', {
                position: index + 1,
              })}
              data-space-icon-option={iconId}
              aria-current={iconId === current ? 'true' : undefined}
              className={cn(
                'flex size-ds-control-sm min-h-0 items-center justify-center p-0',
                iconId === current && 'bg-ds-neutral-muted-default'
              )}
              onSelect={() => choose(iconId)}
            >
              <DsIcon icon={SPACE_ICONS[iconId]} aria-hidden />
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          disabled={current === null}
          onSelect={() => choose(null)}
        >
          <DsIcon icon={CaseSensitive} aria-hidden />
          {t('layout.space-icon-use-letter')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
