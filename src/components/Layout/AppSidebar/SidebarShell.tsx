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
import type { ReactNode } from 'react';

export interface SidebarShellProps {
  children: ReactNode;
  className?: string;
  /** Accessible name for the rail (each page passes its own). */
  ariaLabel?: string;
}

/**
 * Outer rail surface shared by every page in the app layout (workspace, home,
 * settings). Owns the panel chrome only — what goes inside is composed from
 * {@link SidebarSection}, {@link SidebarNavGroup} and `NavTab`.
 */
export function SidebarShell({
  children,
  className,
  ariaLabel,
}: SidebarShellProps) {
  return (
    <aside
      aria-label={ariaLabel}
      className={cn(
        'box-border flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-start overflow-hidden rounded-2xl bg-ds-neutral-default-default p-1',
        className
      )}
    >
      <div className="flex h-full min-h-0 w-full max-w-full min-w-0 flex-col overflow-x-hidden">
        {children}
      </div>
    </aside>
  );
}

export interface SidebarSectionProps {
  children: ReactNode;
  className?: string;
  /**
   * `fixed` — natural height, never scrolls (top nav blocks).
   * `fill` — takes the remaining height and owns its own scrolling child.
   */
  grow?: 'fixed' | 'fill';
}

/** Vertical band inside {@link SidebarShell}. */
export function SidebarSection({
  children,
  className,
  grow = 'fixed',
}: SidebarSectionProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        grow === 'fill' ? 'min-h-0 flex-1 overflow-hidden' : 'shrink-0 gap-1',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Hairline divider between sidebar sections. */
export function SidebarSeparator({ className }: { className?: string }) {
  return (
    <div className={cn('my-2 px-3', className)}>
      <div className="h-px w-full bg-ds-border-neutral-default-default" />
    </div>
  );
}

export interface SidebarNavGroupProps {
  /** Uppercase group heading (e.g. Workspace / Device / Settings). */
  label?: string;
  children: ReactNode;
  className?: string;
}

/** Labelled column of `NavTab` rows. */
export function SidebarNavGroup({
  label,
  children,
  className,
}: SidebarNavGroupProps) {
  return (
    <div className={cn('flex w-full min-w-0 flex-col', className)}>
      {label ? (
        <div className="px-3 pb-1 text-ds-text-meta font-bold tracking-wide text-ds-ink-subtle-default uppercase">
          {label}
        </div>
      ) : null}
      <div className="flex w-full min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}
