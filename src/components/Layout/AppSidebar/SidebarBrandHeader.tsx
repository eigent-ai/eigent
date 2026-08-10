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
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

import { SIDEBAR_TAB_LABEL_CLASS } from './NavTab';

export interface SidebarBrandHeaderProps {
  className?: string;
}

/**
 * 44px brand row for Home / Settings rails. Height matches the content-pane
 * `ContentHeader`; icon size, gap and type match `NavTab` so the mark lines up
 * with the tabs below. `-mt-1` cancels the shell's top padding so this row
 * shares the same top edge as the content header.
 */
export function SidebarBrandHeader({ className }: SidebarBrandHeaderProps) {
  const appearance = useAuthStore((state) => state.appearance);

  return (
    <div
      className={cn(
        '-mt-1 box-border flex h-[44px] min-h-[44px] w-full shrink-0 items-center',
        className
      )}
    >
      <div className="flex h-8 w-full min-w-0 items-center gap-3 px-3">
        {/* Fixed 16px slot matches NavTab icons; larger mark is centered so layout stays put. */}
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <img
            src={
              appearance === 'dark' ? eigentAppIconWhite : eigentAppIconBlack
            }
            alt=""
            className="h-5 max-h-none w-5 max-w-none select-none"
            width={20}
            height={20}
            draggable={false}
          />
        </span>
        <span
          className={cn(
            SIDEBAR_TAB_LABEL_CLASS,
            'font-bold text-ds-text-neutral-muted-default'
          )}
        >
          Eigent
        </span>
      </div>
    </div>
  );
}
