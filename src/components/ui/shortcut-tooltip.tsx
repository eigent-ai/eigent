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

import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import {
  formatKeyboardShortcutKeys,
  getKeyboardShortcutById,
} from '@/shared/keyboardShortcuts';
import type { ReactNode } from 'react';
import { ShortcutKeycap } from './shortcut-keycap';

export interface ShortcutTooltipContentProps {
  label: ReactNode;
  /**
   * Second line under the label. Use when the control needs an explanation on
   * top of its shortcut -- notably a disabled control saying why it is
   * disabled, which must stay visible and not only exposed to screen readers.
   */
  description?: ReactNode;
  /** Use for actions in the shared desktop shortcut catalog. */
  shortcutId?: string;
  /** Use for local control shortcuts such as Return or Shift+Return. */
  shortcutLabel?: string;
}

export function ShortcutTooltipContent({
  label,
  description,
  shortcutId,
  shortcutLabel,
}: ShortcutTooltipContentProps) {
  const platform = useDesktopShortcutPlatform();
  const shortcut = shortcutId
    ? getKeyboardShortcutById(platform, shortcutId)
    : undefined;
  const hint =
    shortcutLabel ??
    (shortcut ? formatKeyboardShortcutKeys(shortcut.keys) : undefined);

  const shortcutRow = (
    <span className="flex h-4 min-w-0 items-center justify-between gap-3 text-label-xs leading-4">
      <span className="min-w-0 leading-4">{label}</span>
      {hint ? <ShortcutKeycap size="compact">{hint}</ShortcutKeycap> : null}
    </span>
  );

  if (!description) {
    return <span className="my-2 flex flex-col">{shortcutRow}</span>;
  }

  return (
    <span className="my-2 flex min-w-0 flex-col gap-1">
      {shortcutRow}
      <span className="min-w-0 max-w-56 text-label-xs leading-4 text-ds-text-neutral-muted-default">
        {description}
      </span>
    </span>
  );
}
