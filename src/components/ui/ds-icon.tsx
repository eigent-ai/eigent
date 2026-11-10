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

/**
 * Two base styles share one line weight: `main` (16px, the standard) and
 * `main-compact` (12px, dense metadata). `illustration` is the only exception,
 * reserved for empty states and onboarding moments.
 */
export type DsIconRecipe = 'main' | 'main-compact' | 'illustration';

/** Illustration sizes; every other icon uses a base style. */
export type DsIllustrationSize = 24 | 32 | 40 | 48;

/** Stroke in screen pixels, independent of the icon's size. */
export const DS_ICON_STROKE_PX = 1.25;
export const DS_ILLUSTRATION_STROKE_PX = 1.5;

const BASE_RECIPES: Record<
  Exclude<DsIconRecipe, 'illustration'>,
  { size: number; className: string }
> = {
  main: { size: 16, className: 'size-ds-icon-md' },
  'main-compact': { size: 12, className: 'size-ds-icon-xs' },
};

const ILLUSTRATION_CLASS: Record<DsIllustrationSize, string> = {
  24: 'size-ds-icon-xl',
  32: 'size-8',
  40: 'size-10',
  48: 'size-12',
};

export function dsIconSpec(
  recipe: DsIconRecipe,
  illustrationSize: DsIllustrationSize = 24
): { size: number; strokeWidth: number; className: string } {
  if (recipe === 'illustration') {
    return {
      size: illustrationSize,
      strokeWidth: DS_ILLUSTRATION_STROKE_PX,
      className: ILLUSTRATION_CLASS[illustrationSize],
    };
  }
  return { ...BASE_RECIPES[recipe], strokeWidth: DS_ICON_STROKE_PX };
}

export type DsIconProps = Omit<
  LucideProps,
  'size' | 'strokeWidth' | 'absoluteStrokeWidth'
> & {
  icon: LucideIcon;
  recipe?: DsIconRecipe;
  /** Only with `recipe="illustration"`. */
  illustrationSize?: DsIllustrationSize;
  decorative?: boolean;
};

export function DsIcon({
  icon: Icon,
  recipe = 'main',
  illustrationSize,
  decorative = true,
  className,
  ...props
}: DsIconProps) {
  const spec = dsIconSpec(recipe, illustrationSize);
  return (
    <Icon
      size={spec.size}
      strokeWidth={spec.strokeWidth}
      // Lucide scales its 24-unit stroke with the icon size by default; the
      // design system specifies the stroke in screen pixels instead.
      absoluteStrokeWidth
      aria-hidden={decorative ? true : undefined}
      className={cn('shrink-0 text-current', spec.className, className)}
      {...props}
    />
  );
}
