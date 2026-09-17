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

import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { cn } from '@/lib/utils';
import {
  formatKeyboardShortcutKeys,
  getKeyboardShortcutById,
} from '@/shared/keyboardShortcuts';
import type { PreviewTabKind } from '@/store/pageTabStore';
import { useTranslation } from 'react-i18next';
import { PREVIEW_TAB_KINDS } from '../tabKinds';

export interface ChooserTabProps {
  /** Open the given content kind (replaces this chooser tab in place). */
  onChoose: (kind: PreviewTabKind) => void;
}

/** The four default view types. Session processes are listed in Summary. */
export function ChooserTab({ onChoose }: ChooserTabProps) {
  const { t } = useTranslation();
  const shortcutPlatform = useDesktopShortcutPlatform();
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col gap-1.5">
          {PREVIEW_TAB_KINDS.map(
            ({
              kind,
              icon: Icon,
              labelKey,
              defaultLabel,
              descriptionKey,
              defaultDescription,
            }) => {
              const label = t(labelKey, { defaultValue: defaultLabel });
              const shortcutId =
                kind === 'browser'
                  ? 'open-preview-browser'
                  : kind === 'terminal'
                    ? 'open-preview-terminal'
                    : undefined;
              const shortcut = shortcutId
                ? getKeyboardShortcutById(shortcutPlatform, shortcutId)
                : undefined;

              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChoose(kind)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-xl border border-x border-y border-solid border-transparent bg-ds-neutral-default-default px-3 py-2.5 text-left transition-colors',
                    'hover:border-ds-hairline-default-hover hover:bg-ds-neutral-default-hover',
                    DS_FOCUS_RING
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-neutral-subtle-default text-ds-ink-default-default">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-ds-ink-default-default">
                      {label}
                    </span>
                    <span className="truncate text-xs text-ds-ink-muted-default">
                      {t(descriptionKey, {
                        defaultValue: defaultDescription,
                      })}
                    </span>
                  </span>
                  {shortcut ? (
                    <ShortcutKeycap aria-hidden>
                      {formatKeyboardShortcutKeys(shortcut.keys)}
                    </ShortcutKeycap>
                  ) : null}
                </button>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}

export default ChooserTab;
