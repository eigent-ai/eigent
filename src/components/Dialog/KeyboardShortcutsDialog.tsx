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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { ShortcutKeycap } from '@/components/ui/shortcut-keycap';
import {
  getKeyboardShortcutGroups,
  type DesktopShortcutPlatform,
} from '@/shared/keyboardShortcuts';
import { useTranslation } from 'react-i18next';

export interface KeyboardShortcutsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  platform: DesktopShortcutPlatform;
}

export default function KeyboardShortcutsDialog({
  onOpenChange,
  open,
  platform,
}: KeyboardShortcutsDialogProps) {
  const { t } = useTranslation();
  const groups = getKeyboardShortcutGroups(platform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" overlayVariant="dimmed">
        <DialogHeader
          title={t('layout.shortcuts.title')}
          subtitle={t('layout.shortcuts.subtitle')}
        />
        <DialogContentSection className="scrollbar-always-visible max-h-[min(65vh,540px)] overflow-y-auto p-4">
          <div className="flex flex-col gap-5" data-keyboard-shortcuts-list>
            {groups.map((group) => (
              <section
                key={group.id}
                className="flex min-w-0 flex-col gap-2 rounded-xl bg-ds-neutral-default-default p-4"
                aria-labelledby={`shortcut-group-${group.id}`}
              >
                <span
                  id={`shortcut-group-${group.id}`}
                  className="m-0 text-ds-text-meta font-semibold tracking-wide text-ds-ink-muted-default uppercase"
                >
                  {t(group.labelKey, { defaultValue: group.defaultLabel })}
                </span>
                <ul className="m-0 flex list-none flex-col p-0">
                  {group.shortcuts.map((shortcut) => {
                    const label = t(shortcut.labelKey, {
                      defaultValue: shortcut.defaultLabel,
                    });
                    return (
                      <li
                        key={shortcut.id}
                        data-keyboard-shortcut-row
                        className="flex h-9 items-center justify-between gap-4 border-x-0 border-t-0 border-b-[1px] border-solid border-ds-hairline-subtle-default px-2 text-ds-text-base text-ds-ink-default-default"
                      >
                        <span className="min-w-0 truncate">{label}</span>
                        <span
                          className="flex shrink-0 items-center gap-1"
                          aria-label={t('layout.keyboard-shortcut-label', {
                            label,
                            keys: shortcut.keys.join('+'),
                            defaultValue: '{{label}}: {{keys}}',
                          })}
                        >
                          {shortcut.keys.map((key, index) => (
                            <ShortcutKeycap
                              key={`${shortcut.id}-${key}-${index}`}
                              aria-hidden
                            >
                              {key}
                            </ShortcutKeycap>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
