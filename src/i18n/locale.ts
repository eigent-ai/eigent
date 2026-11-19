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

export enum LocaleEnum {
  SimplifiedChinese = 'zh-Hans',
  TraditionalChinese = 'zh-Hant',
  English = 'en-US',
  German = 'de',
  Korean = 'ko',
  Japanese = 'ja',
  French = 'fr',
  Russian = 'ru',
  Italian = 'it',
  Arabic = 'ar',
  Spanish = 'es',
}

const BASE_LANGUAGE_LOCALES: Readonly<Record<string, LocaleEnum>> = {
  ar: LocaleEnum.Arabic,
  de: LocaleEnum.German,
  es: LocaleEnum.Spanish,
  fr: LocaleEnum.French,
  it: LocaleEnum.Italian,
  ja: LocaleEnum.Japanese,
  ko: LocaleEnum.Korean,
  ru: LocaleEnum.Russian,
};

/**
 * Resolves persisted and browser language tags to one of Eigent's canonical
 * resource codes. Matching is case-insensitive and accepts underscore tags.
 */
export function resolveLocale(
  language: string | null | undefined,
  fallback: LocaleEnum = LocaleEnum.English
): LocaleEnum {
  const normalized = language?.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return fallback;

  if (normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) {
    return LocaleEnum.SimplifiedChinese;
  }
  if (normalized === 'zh-hant' || normalized.startsWith('zh-hant-')) {
    return LocaleEnum.TraditionalChinese;
  }

  const [base, region] = normalized.split('-');
  if (base === 'en') return LocaleEnum.English;
  if (base === 'zh') {
    if (region === 'cn' || region === 'sg') {
      return LocaleEnum.SimplifiedChinese;
    }
    if (region === 'tw' || region === 'hk' || region === 'mo') {
      return LocaleEnum.TraditionalChinese;
    }
    return fallback;
  }

  return BASE_LANGUAGE_LOCALES[base] ?? fallback;
}
