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

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { mergeAliasStyles, tooltipTokenAliases } from './tokenAliases';

/** Default hover delay before a tooltip opens (Radix default is 700ms). */
const TOOLTIP_DELAY_MS = 300;

/** Longer hover delay for labeled controls whose tooltip is a shortcut hint. */
const TOOLTIP_DELAYED_MS = 1000;

/** Delay skipped when moving between tooltip triggers (Radix default is 300ms). */
const TOOLTIP_SKIP_DELAY_MS = 300;

const TOOLTIP_ANIMATED_CONTENT_CLASS =
  'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=instant-open]:animate-none';

const TooltipProviderPresenceContext = React.createContext(false);

/**
 * The app mounts a single provider (see main.tsx) so the "warm cursor"
 * skip-delay window is shared across every tooltip. Don't nest providers
 * around individual tooltips — that isolates them from the shared window.
 */
const TooltipProvider = ({
  delayDuration = TOOLTIP_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipProviderPresenceContext.Provider value>
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    >
      {children}
    </TooltipPrimitive.Provider>
  </TooltipProviderPresenceContext.Provider>
);

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * - `default`: animated open/close; use for informational content (truncated
 *   text, hints, review details). Skips the animation when opened inside the
 *   warm-cursor window (`data-state="instant-open"`).
 * - `instant`: no animation at all; use for navigation and layout controls
 *   where the tooltip is just a label.
 * - `delayed`: same animation as `default`, but waits 1s. Use for labeled
 *   sidebar tabs where the tooltip is a shortcut hint, not the only label.
 */
const tooltipContentVariants = cva(
  'rounded-ds-compact-control border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-8 py-ds-6 text-ds-text-meta text-ds-ink-default-default shadow-ds-elevation-floating backdrop-blur-sm z-[100] origin-(--radix-tooltip-content-transform-origin) overflow-hidden border-solid',
  {
    variants: {
      variant: {
        default: TOOLTIP_ANIMATED_CONTENT_CLASS,
        delayed: TOOLTIP_ANIMATED_CONTENT_CLASS,
        instant: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type TooltipVariant = VariantProps<typeof tooltipContentVariants>['variant'];

function delayForTooltipVariant(variant: TooltipVariant): number | undefined {
  if (variant === 'instant') return 0;
  if (variant === 'delayed') return TOOLTIP_DELAYED_MS;
  return undefined;
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> &
    VariantProps<typeof tooltipContentVariants>
>(({ className, sideOffset = 4, style, variant, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(tooltipContentVariants({ variant }), className)}
      style={mergeAliasStyles(tooltipTokenAliases, style)}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * A simpler interface for Tooltip when you just need a trigger and content.
 *
 * Pick the variant by intent:
 * - `variant="instant"` — opens immediately with no animation. For
 *   navigation/layout buttons where the tooltip is just a label.
 * - `variant="default"` — opens after the shared hover delay with the
 *   standard animation. For informational content (truncated text, hints).
 * - `variant="delayed"` — opens after 1s with the standard animation. For
 *   labeled sidebar tabs whose tooltip is a shortcut hint.
 *
 * Usage:
 * ```jsx
 * <TooltipSimple content="This is a tooltip">
 *  <button>Hover me</button>
 * </TooltipSimple>
 * ```
 */
interface TooltipSimpleProps extends Omit<
  React.ComponentPropsWithoutRef<typeof TooltipContent>,
  'children' | 'content'
> {
  children: React.ReactNode;
  content: React.ReactNode;
  /** Overrides the variant's delay; prefer picking the right variant. */
  delayDuration?: number;
  /** Removes vertical content padding for single-line label/keycap tooltips. */
  compact?: boolean;
  enabled?: boolean;
  variant?: TooltipVariant;
}

const TooltipSimple = React.forwardRef<
  React.ElementRef<typeof TooltipContent>,
  TooltipSimpleProps
>(
  (
    {
      children,
      content,
      className,
      compact = false,
      sideOffset = 4,
      delayDuration,
      enabled = true,
      variant = 'default',
      ...props
    },
    ref
  ) => {
    const hasTooltipProvider = React.useContext(TooltipProviderPresenceContext);
    const [open, setOpen] = React.useState(false);

    React.useLayoutEffect(() => {
      if (!enabled) {
        setOpen(false);
      }
    }, [enabled]);

    const tooltip = (
      <Tooltip
        open={enabled && open}
        onOpenChange={(nextOpen) => {
          if (enabled) {
            setOpen(nextOpen);
          }
        }}
        delayDuration={delayDuration ?? delayForTooltipVariant(variant)}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>

        {enabled && (
          <TooltipContent
            ref={ref}
            sideOffset={sideOffset}
            variant={variant}
            className={cn(compact && 'py-0', className)}
            {...props}
          >
            {content}
          </TooltipContent>
        )}
      </Tooltip>
    );

    return hasTooltipProvider ? (
      tooltip
    ) : (
      <TooltipProvider>{tooltip}</TooltipProvider>
    );
  }
);
TooltipSimple.displayName = 'TooltipSimple';

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipSimple,
  TooltipTrigger,
};
export type { TooltipVariant };
