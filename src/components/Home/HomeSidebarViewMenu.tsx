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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  usePageTabStore,
  type HomeSidebarGrouping,
  type HomeSpaceSort,
} from '@/store/pageTabStore';
import {
  ArrowUpDown,
  Check,
  Ellipsis,
  LayoutList,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Choice<T extends string> {
  value: T;
  label: string;
}

/** A submenu of choices with a check on the current one, like Language. */
function ChoiceSubmenu<T extends string>({
  icon,
  label,
  value,
  choices,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <DsIcon icon={icon} aria-hidden />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="min-w-44"
        sideOffset={6}
        alignOffset={-4}
      >
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <DropdownMenuItem
              key={choice.value}
              className="gap-2"
              aria-checked={selected}
              role="menuitemradio"
              onSelect={() => onChange(choice.value)}
            >
              <span className="min-w-0 flex-1 truncate">{choice.label}</span>
              {selected ? (
                <DsIcon
                  icon={Check}
                  className="shrink-0 text-ds-accent-default-default"
                  aria-hidden
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The Spaces header's More menu: how Home's sidebar sorts and groups. */
export function HomeSidebarViewMenu() {
  const { t } = useTranslation();
  const sort = usePageTabStore((state) => state.homeSpaceSort);
  const setSort = usePageTabStore((state) => state.setHomeSpaceSort);
  const grouping = usePageTabStore((state) => state.homeSidebarGrouping);
  const setGrouping = usePageTabStore((state) => state.setHomeSidebarGrouping);
  const label = t('layout.spaces-view-options');

  const sortChoices: Choice<HomeSpaceSort>[] = [
    { value: 'updated', label: t('layout.home-sort-updated') },
    { value: 'created', label: t('layout.home-sort-created') },
  ];
  const groupingChoices: Choice<HomeSidebarGrouping>[] = [
    { value: 'spaces', label: t('layout.spaces') },
    { value: 'list', label: t('layout.organize-one-list') },
  ];

  return (
    <DropdownMenu>
      <TooltipSimple content={label} compact side="bottom" variant="instant">
        <span className="inline-flex">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              buttonContent="icon-only"
              aria-label={label}
            >
              <DsIcon icon={Ellipsis} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </span>
      </TooltipSimple>
      <DropdownMenuContent align="end" sideOffset={6}>
        <ChoiceSubmenu
          icon={ArrowUpDown}
          label={t('layout.sort-by')}
          value={sort}
          choices={sortChoices}
          onChange={setSort}
        />
        <ChoiceSubmenu
          icon={LayoutList}
          label={t('layout.organize-by')}
          value={grouping}
          choices={groupingChoices}
          onChange={setGrouping}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
