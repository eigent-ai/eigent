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

import { LocaleEnum, switchLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { getLanguageLabel } from '@web/components/profile/profileLabels';

const LANGUAGE_OPTIONS = [
  LocaleEnum.English,
  LocaleEnum.SimplifiedChinese,
  LocaleEnum.TraditionalChinese,
  LocaleEnum.Japanese,
  LocaleEnum.Korean,
  LocaleEnum.French,
  LocaleEnum.German,
  LocaleEnum.Russian,
  LocaleEnum.Italian,
  LocaleEnum.Arabic,
  LocaleEnum.Spanish,
];

export function ProfileLanguageSection() {
  const language = useAuthStore((state) => state.language);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2">
      {LANGUAGE_OPTIONS.map((option) => {
        const active = language === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => switchLanguage(option)}
            className={cn(
              'rounded-xl border border-solid px-4 py-3 text-left transition-colors',
              active
                ? 'border-ds-border-brand-default-focus bg-ds-bg-neutral-default-default shadow-sm'
                : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default hover:bg-ds-bg-neutral-default-hover'
            )}
          >
            <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
              {getLanguageLabel(option)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
