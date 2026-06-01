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

import { useAuthStore } from '@/store/authStore';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export enum LocaleEnum {
  English = 'en',
  SimplifiedChinese = 'zh-CN',
  TraditionalChinese = 'zh-TW',
  Japanese = 'ja',
  Korean = 'ko',
  French = 'fr',
  German = 'de',
  Russian = 'ru',
  Italian = 'it',
  Arabic = 'ar',
  Spanish = 'es',
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          'layout.workspace-session-single-agent': 'Single Agent',
          'layout.workspace-session-workforce': 'Workforce',
          'layout.please-select-model-first': 'Please select a model first.',
          'layout.web-task-busy': 'Current task is in progress.',
          'chat.follow-up-placeholder': 'Send a follow-up…',
        },
      },
    },
  });
}

export function switchLanguage(language: LocaleEnum | string) {
  useAuthStore.getState().setLanguage(language);
  void i18n.changeLanguage(language === 'system' ? 'en' : language);
}

export default i18n;
