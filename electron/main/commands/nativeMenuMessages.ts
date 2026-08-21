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

import arLayout from '../../../src/i18n/locales/ar/layout.json';
import deLayout from '../../../src/i18n/locales/de/layout.json';
import enLayout from '../../../src/i18n/locales/en-us/layout.json';
import esLayout from '../../../src/i18n/locales/es/layout.json';
import frLayout from '../../../src/i18n/locales/fr/layout.json';
import itLayout from '../../../src/i18n/locales/it/layout.json';
import jaLayout from '../../../src/i18n/locales/ja/layout.json';
import koLayout from '../../../src/i18n/locales/ko/layout.json';
import ruLayout from '../../../src/i18n/locales/ru/layout.json';
import zhHansLayout from '../../../src/i18n/locales/zh-Hans/layout.json';
import zhHantLayout from '../../../src/i18n/locales/zh-Hant/layout.json';
import {
  isNativeMenuLocale,
  normalizeNativeMenuLocale,
  type NativeMenuLocale,
} from '../../../src/shared/nativeMenu';

type NativeMenuMessageKey = keyof typeof enLayout.nativeMenu;

export type NativeMenuMessages = Record<NativeMenuMessageKey, string>;

const catalogs = {
  'en-US': enLayout.nativeMenu,
  'zh-Hans': zhHansLayout.nativeMenu,
  'zh-Hant': zhHantLayout.nativeMenu,
  de: deLayout.nativeMenu,
  ko: koLayout.nativeMenu,
  ja: jaLayout.nativeMenu,
  fr: frLayout.nativeMenu,
  ru: ruLayout.nativeMenu,
  it: itLayout.nativeMenu,
  ar: arLayout.nativeMenu,
  es: esLayout.nativeMenu,
} satisfies Record<NativeMenuLocale, NativeMenuMessages>;

export function resolveNativeMenuLocale(value: string): NativeMenuLocale {
  return normalizeNativeMenuLocale(value) ?? 'en-US';
}

export function getNativeMenuMessages(
  locale: NativeMenuLocale | string
): NativeMenuMessages {
  return catalogs[resolveNativeMenuLocale(locale)];
}

export function formatNativeMenuMessage(
  message: string,
  appName: string
): string {
  return message.replaceAll('{appName}', appName);
}

export function applyNativeMenuLocaleChange(
  current: NativeMenuLocale | null,
  next: unknown,
  onChange: (locale: NativeMenuLocale) => void
): boolean {
  if (!isNativeMenuLocale(next) || next === current) return false;
  onChange(next);
  return true;
}
