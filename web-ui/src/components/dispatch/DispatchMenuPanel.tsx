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

import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import eigentAppIconWhite from '@/assets/logo/icon_white.svg';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useSpaces } from '@web/hooks/useSpaces';
import type { WebSpace } from '@web/types';
import { ArrowLeft, Briefcase, Settings, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function SpaceBentoCard({
  space,
  active,
  onSelect,
}: {
  space: WebSpace;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = space.id === 'work' ? Briefcase : User;
  const accentClass =
    space.id === 'work'
      ? 'bg-ds-bg-brand-default-default/15 text-ds-text-brand-default-default'
      : 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex min-h-[56px] w-full flex-row items-center gap-3 rounded-xl border border-solid p-3 text-left transition-colors',
        active
          ? 'border-ds-bg-neutral-strong-default bg-ds-bg-neutral-strong-default'
          : 'border-ds-bg-neutral-default-default bg-ds-bg-neutral-default-default hover:border-ds-bg-neutral-default-hover hover:bg-ds-bg-neutral-default-hover'
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          accentClass
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
        {space.name}
      </span>
    </button>
  );
}

export function DispatchMenuPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const appearance = useAuthStore((state) => state.appearance);
  const { spaces, activeSpaceId, setActiveSpace } = useSpaces();
  const eigentIcon =
    appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack;

  const handleSelectSpace = (spaceId: string) => {
    setActiveSpace(spaceId);
    onOpenChange(false);
  };

  const handleOpenProfile = () => {
    onOpenChange(false);
    navigate('/profile');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        variant="ghost"
        className="flex h-full w-[18rem] max-w-[18rem] flex-col gap-0 overflow-hidden border-0 p-0.5 sm:max-w-[18rem] [&>button]:hidden"
      >
        <SheetTitle className="sr-only">Dispatch menu</SheetTitle>
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-ds-bg-neutral-subtle-default">
          <header className="border-b-1 flex h-12 shrink-0 items-center gap-2 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-default px-3">
            <Button
              variant="ghost"
              size="md"
              buttonContent="icon-only"
              buttonRadius="full"
              aria-label="Close menu"
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <img
                src={eigentIcon}
                alt=""
                className="-mb-0.5 h-6 w-6 shrink-0 select-none"
                aria-hidden
              />
              <span className="text-body-base truncate font-display font-semibold text-ds-text-neutral-default-default">
                Eigent
              </span>
            </div>
            <Button
              variant="ghost"
              size="md"
              buttonContent="icon-only"
              buttonRadius="full"
              aria-label="Profile settings"
              onClick={handleOpenProfile}
            >
              <Settings />
            </Button>
          </header>

          <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
            <div className="flex w-full flex-col gap-2">
              {spaces.map((space) => (
                <SpaceBentoCard
                  key={space.id}
                  space={space}
                  active={space.id === activeSpaceId}
                  onSelect={() => handleSelectSpace(space.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
