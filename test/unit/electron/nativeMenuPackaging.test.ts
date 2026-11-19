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

import { describe, expect, it } from 'vitest';
import builderConfig from '../../../electron-builder.json';

describe('native menu packaging locales', () => {
  it('retains every supported Electron locale resource', () => {
    expect(builderConfig.electronLanguages).toEqual([
      'ar',
      'de',
      'en-US',
      'es',
      'fr',
      'it',
      'ja',
      'ko',
      'ru',
      'zh-CN',
      'zh-TW',
    ]);
  });

  it('advertises every supported macOS localization', () => {
    expect(builderConfig.mac.extendInfo.CFBundleLocalizations).toEqual([
      'ar',
      'de',
      'en',
      'es',
      'fr',
      'it',
      'ja',
      'ko',
      'ru',
      'zh-Hans',
      'zh-Hant',
    ]);
  });
});
