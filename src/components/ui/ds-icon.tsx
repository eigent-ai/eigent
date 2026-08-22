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

import { cn } from '@/lib/utils';
import type { LucideIcon, LucideProps } from 'lucide-react';

export type DsIconRecipe = 'main' | 'main-compact' | 'detailed';

const ICON_RECIPES: Record<
  DsIconRecipe,
  { size: number; strokeWidth: number; className: string }
> = {
  main: {
    size: 16,
    strokeWidth: 1.25,
    className: 'size-ds-icon-md',
  },
  'main-compact': {
    size: 12,
    strokeWidth: 1.25,
    className: 'size-ds-icon-xs',
  },
  detailed: {
    size: 24,
    strokeWidth: 1.5,
    className: 'size-ds-icon-xl',
  },
};

export type DsIconProps = Omit<LucideProps, 'size' | 'strokeWidth'> & {
  icon: LucideIcon;
  recipe?: DsIconRecipe;
  decorative?: boolean;
};

export function DsIcon({
  icon: Icon,
  recipe = 'main',
  decorative = true,
  className,
  ...props
}: DsIconProps) {
  const spec = ICON_RECIPES[recipe];
  return (
    <Icon
      size={spec.size}
      strokeWidth={spec.strokeWidth}
      aria-hidden={decorative ? true : undefined}
      className={cn('shrink-0 text-current', spec.className, className)}
      {...props}
    />
  );
}
