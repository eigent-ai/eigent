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

export const NATIVE_MENU_LOCALE_CHANNEL = 'native-menu:set-locale' as const;

export const NATIVE_MENU_LOCALES = [
  'en-US',
  'zh-Hans',
  'zh-Hant',
  'de',
  'ko',
  'ja',
  'fr',
  'ru',
  'it',
  'ar',
  'es',
] as const;

export type NativeMenuLocale = (typeof NATIVE_MENU_LOCALES)[number];

export function isNativeMenuLocale(value: unknown): value is NativeMenuLocale {
  return (
    typeof value === 'string' &&
    (NATIVE_MENU_LOCALES as readonly string[]).includes(value)
  );
}

export function normalizeNativeMenuLocale(
  value: unknown
): NativeMenuLocale | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (normalized.startsWith('zh')) {
    return /(?:hant|tw|hk|mo)/.test(normalized) ? 'zh-Hant' : 'zh-Hans';
  }
  if (normalized.startsWith('en')) return 'en-US';

  const language = normalized.split('-')[0];
  return isNativeMenuLocale(language) ? language : null;
}
