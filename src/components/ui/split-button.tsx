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

import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './dropdown-menu';

export interface SplitButtonProps {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  menuLabel: string;
  children: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  actionDisabled?: boolean;
  menuDisabled?: boolean;
}

/** Two independent controls with one connected outline. The shared Button
 * recipes own height, padding, icons and focus; only the joined corners differ. */
export function SplitButton({
  label,
  icon,
  onClick,
  menuLabel,
  children,
  size = 'sm',
  disabled,
  actionDisabled,
  menuDisabled,
}: SplitButtonProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="split-button"
      className="inline-flex shrink-0 items-center rounded-full"
    >
      <Button
        type="button"
        variant="secondary"
        size={size}
        disabled={disabled || actionDisabled}
        onClick={onClick}
        className="!rounded-e-none focus-visible:z-10 active:scale-100"
      >
        {icon}
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size={size}
            buttonContent="icon-only"
            aria-label={menuLabel}
            disabled={disabled || menuDisabled}
            className="!rounded-s-none !border-s-ds-hairline-default-default focus-visible:z-10 active:scale-100"
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
