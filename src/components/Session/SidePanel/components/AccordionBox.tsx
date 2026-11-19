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
  SessionPanelButton,
  SessionPanelCollapse,
  type SessionPanelRowVariant,
} from '@/components/Session/SidePanel/sections/primitives';
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import { type ReactNode, useState } from 'react';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const LAYOUT_TRANSITION = {
  layout: { duration: 0.28, ease: CONTENT_EASE },
} as const;

export type SidePanelAccordionRenderArgs = { open: boolean };

export type SidePanelAccordionChildren =
  ReactNode | ((state: SidePanelAccordionRenderArgs) => ReactNode);

export function SidePanelAccordionBox({
  title,
  titleSuffix,
  headerAction,
  leading,
  rowVariant = 'section',
  contentClassName,
  collapsedPreview,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  /** Small adornment rendered right after the title (e.g. count pill). */
  titleSuffix?: ReactNode;
  /** Independent action rendered beside the section title (never toggles the accordion). */
  headerAction?: ReactNode;
  /** Optional leading icon; main section rows intentionally omit this. */
  leading?: ReactNode;
  /** Shared row appearance used by main sections and nested categories. */
  rowVariant?: SessionPanelRowVariant;
  contentClassName?: string;
  /**
   * Compact content below the header when collapsed (static `children` only;
   * render-prop children control their own open/closed layout).
   */
  collapsedPreview?: ReactNode;
  /**
   * Static: classic accordion — body hidden when closed.
   * Render prop: body stays in one region; switch layout by `open` (e.g. summary vs full list).
   */
  children: SidePanelAccordionChildren;
  defaultOpen?: boolean;
  /** Controlled open state for lifecycle-aware sections. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toggleOpen = () => {
    const nextOpen = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const isRenderProp = typeof children === 'function';
  const dynamicBody = isRenderProp
    ? (children as (s: SidePanelAccordionRenderArgs) => ReactNode)({ open })
    : null;
  const stickyHeader = rowVariant === 'section';

  return (
    <motion.div
      layout={!shouldReduceMotion}
      transition={
        shouldReduceMotion ? { layout: { duration: 0 } } : LAYOUT_TRANSITION
      }
      className="z-10 flex min-w-0 shrink-0 flex-col overflow-visible"
    >
      <div
        className={cn(
          'flex h-10 min-h-10 w-full shrink-0 items-center',
          stickyHeader && 'sticky top-0 z-20 bg-ds-neutral-default-default'
        )}
      >
        <div className="min-w-0 flex-1">
          <SessionPanelButton
            variant={rowVariant}
            leading={leading}
            badge={titleSuffix}
            chevron
            open={open}
            ariaExpanded={open}
            onClick={toggleOpen}
          >
            {title}
          </SessionPanelButton>
        </div>
        {headerAction ? (
          <div className="flex h-10 shrink-0 items-center pr-0.5">
            {headerAction}
          </div>
        ) : null}
      </div>

      {isRenderProp ? (
        <SessionPanelCollapse open={dynamicBody != null}>
          <motion.div
            layout={!shouldReduceMotion}
            transition={
              shouldReduceMotion
                ? { layout: { duration: 0 } }
                : LAYOUT_TRANSITION
            }
            className={cn('w-full', contentClassName)}
          >
            {dynamicBody}
          </motion.div>
        </SessionPanelCollapse>
      ) : (
        <>
          <SessionPanelCollapse open={open}>
            <div className={cn('w-full', contentClassName)}>
              {children as ReactNode}
            </div>
          </SessionPanelCollapse>
          {collapsedPreview ? (
            <SessionPanelCollapse open={!open}>
              <div className={cn('w-full', contentClassName)}>
                {collapsedPreview}
              </div>
            </SessionPanelCollapse>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
