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

import { LocaleEnum, resolveLocale } from '@/i18n/locale';
import { describe, expect, it } from 'vitest';

describe('resolveLocale', () => {
  it.each(['en', 'en-US', 'EN-gb', 'en_AU'])(
    'maps %s to canonical English',
    (language) => {
      expect(resolveLocale(language)).toBe(LocaleEnum.English);
    }
  );

  it.each(['zh-Hans', 'ZH_hans', 'zh-CN', 'zh-SG'])(
    'maps %s to Simplified Chinese',
    (language) => {
      expect(resolveLocale(language)).toBe(LocaleEnum.SimplifiedChinese);
    }
  );

  it.each(['zh-Hant', 'ZH_hant', 'zh-TW', 'zh-HK', 'zh-MO'])(
    'maps %s to Traditional Chinese',
    (language) => {
      expect(resolveLocale(language)).toBe(LocaleEnum.TraditionalChinese);
    }
  );

  it.each([
    ['de-DE', LocaleEnum.German],
    ['es-MX', LocaleEnum.Spanish],
    ['fr-CA', LocaleEnum.French],
    ['it-IT', LocaleEnum.Italian],
    ['ja-JP', LocaleEnum.Japanese],
    ['ko-KR', LocaleEnum.Korean],
    ['ru-RU', LocaleEnum.Russian],
    ['ar-SA', LocaleEnum.Arabic],
  ])(
    'maps supported regional tag %s by base language',
    (language, expected) => {
      expect(resolveLocale(language)).toBe(expected);
    }
  );

  it('uses the supplied fallback for empty and unsupported tags', () => {
    expect(resolveLocale(undefined, LocaleEnum.German)).toBe(LocaleEnum.German);
    expect(resolveLocale('pt-BR', LocaleEnum.French)).toBe(LocaleEnum.French);
    expect(resolveLocale('zh', LocaleEnum.TraditionalChinese)).toBe(
      LocaleEnum.TraditionalChinese
    );
  });
});
