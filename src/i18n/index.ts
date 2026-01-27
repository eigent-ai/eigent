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

import { getAuthStore } from '@/store/authStore';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './locales';

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

const { language } = getAuthStore();

const savedLanguage = language?.toLowerCase();
const systemLanguage = navigator.language.toLowerCase();
const availableLanguages = Object.values(LocaleEnum);

let initialLanguage: string;

if (savedLanguage && availableLanguages.includes(savedLanguage as LocaleEnum)) {
  initialLanguage = savedLanguage;
} else {
  const matched = availableLanguages.find((lang) =>
    systemLanguage.startsWith(lang)
  );
  initialLanguage = matched || LocaleEnum.English;
}

i18n.use(initReactI18next).init({
  resources,
  fallbackLng: LocaleEnum.English,
  lng: initialLanguage,
  interpolation: {
    escapeValue: false,
  },
});

export const switchLanguage = (lang: LocaleEnum) => {
  console.log('switchLanguage', lang);
  i18n.changeLanguage(lang);
  getAuthStore().setLanguage(lang);
};

export default i18n;
