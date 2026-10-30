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

import { trialQuotaCopy } from '@/lib/trialQuotaCopy';
import { createInstance } from 'i18next';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../src/i18n/locales');
const locales = fs
  .readdirSync(root)
  .filter((locale) => fs.existsSync(path.join(root, locale, 'chat.json')));
const english = JSON.parse(
  fs.readFileSync(path.join(root, 'en-us/chat.json'), 'utf8')
);
const keys = Object.keys(english).filter((key) =>
  /^usage-limit-(plan-)?trial-/.test(key)
);
const placeholders = (copy: string) =>
  [...copy.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort();

describe('trial quota locale contract', () => {
  it.each(locales)(
    '%s has complete copy and matching placeholders for every trial state',
    async (locale) => {
      const chat = JSON.parse(
        fs.readFileSync(path.join(root, locale, 'chat.json'), 'utf8')
      );
      const i18n = createInstance();
      const language = locale === 'en-us' ? 'en-US' : locale;
      await i18n.init({
        lng: language,
        fallbackLng: false,
        resources: { [language]: { translation: { chat } } },
        interpolation: { escapeValue: false },
      });
      for (const key of keys) {
        expect(typeof chat[key]).toBe('string');
        expect(placeholders(chat[key])).toEqual(placeholders(english[key]));
      }
      for (const plan_key of ['pro', 'plus']) {
        for (const period of ['daily', 'total'] as const) {
          for (const exhausted of [false, true]) {
            const copy = trialQuotaCopy(
              { plan_key, is_trialing: true },
              period,
              exhausted,
              (key, options) => i18n.t(key, options),
              96
            );
            expect(copy).toContain(plan_key === 'pro' ? 'Pro' : 'Plus');
            expect(copy).not.toMatch(/{{|chat\./);
            if (!exhausted) expect(copy).toContain('96');
          }
        }
      }
    }
  );
});
