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
import type { SettingsSectionId } from '@/store/settingsDialogStore';
import { useTranslation } from 'react-i18next';
import { preloadSettingsSection } from './SettingsDialogContent';
import { SETTINGS_NAVIGATION } from './settingsNavigation';

interface SettingsDialogSidebarProps {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}

export default function SettingsDialogSidebar({
  activeSection,
  onSectionChange,
}: SettingsDialogSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="max-md:w-[196px] flex min-h-0 w-[200px] shrink-0 flex-col border-y-0 border-l-0 border-r border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default">
      <nav
        aria-label={t('layout.settings', { defaultValue: 'Settings' })}
        className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto pl-3 pr-1 pt-3"
      >
        {SETTINGS_NAVIGATION.map((group) => (
          <div key={group.scope} className="mb-5 last:mb-0">
            <div className="px-2 pb-1.5 text-label-xs font-bold uppercase tracking-wide text-ds-text-neutral-subtle-default">
              {t(group.labelKey, { defaultValue: group.defaultLabel })}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSectionChange(item.id)}
                    onFocus={() => preloadSettingsSection(item.id)}
                    onPointerEnter={() => preloadSettingsSection(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group flex h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm font-semibold leading-5 outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus',
                      isActive
                        ? 'bg-ds-bg-brand-default-default !text-ds-text-brand-inverse-default hover:bg-ds-bg-brand-subtle-default active:bg-ds-bg-brand-default-active'
                        : '!text-ds-text-neutral-muted-default hover:bg-ds-bg-brand-subtle-default hover:!text-ds-text-brand-inverse-default'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive
                          ? '!text-ds-text-brand-inverse-default'
                          : 'text-current group-hover:!text-ds-text-brand-inverse-default'
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">
                      {t(item.labelKey, { defaultValue: item.defaultLabel })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
