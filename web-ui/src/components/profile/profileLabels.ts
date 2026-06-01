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

import { LocaleEnum } from '@/i18n';
import type { Mode } from '@/lib/themeTokens/types';
import type {
  AppearanceMode,
  WorkspaceMainBackground,
} from '@/store/authStore';

const LANGUAGE_LABELS: Record<string, string> = {
  [LocaleEnum.English]: 'English',
  [LocaleEnum.SimplifiedChinese]: '简体中文',
  [LocaleEnum.TraditionalChinese]: '繁體中文',
  [LocaleEnum.Japanese]: '日本語',
  [LocaleEnum.Korean]: '한국어',
  [LocaleEnum.French]: 'Français',
  [LocaleEnum.German]: 'Deutsch',
  [LocaleEnum.Russian]: 'Русский',
  [LocaleEnum.Italian]: 'Italiano',
  [LocaleEnum.Arabic]: 'العربية',
  [LocaleEnum.Spanish]: 'Español',
  system: 'System',
};

const WORKSPACE_BACKGROUND_LABELS: Record<WorkspaceMainBackground, string> = {
  empty: 'Empty',
  dots: 'Dots',
  blocks: 'Blocks',
  ruled: 'Ruled',
  dotted: 'Dotted',
  dashed: 'Dashed',
};

export function getModelTypeLabel(
  modelType: 'cloud' | 'custom' | 'local'
): string {
  switch (modelType) {
    case 'cloud':
      return 'Eigent Cloud';
    case 'custom':
      return 'Custom Model';
    case 'local':
      return 'Local Model';
  }
}

export function getAppearanceLabel(
  appearanceMode: AppearanceMode,
  appearance: Mode
): string {
  if (appearanceMode === 'system') {
    return appearance === 'dark' ? 'System · Dark' : 'System · Light';
  }
  return appearanceMode === 'dark' ? 'Dark' : 'Light';
}

export function getLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

export function getWorkspaceBackgroundLabel(
  background: WorkspaceMainBackground
): string {
  return WORKSPACE_BACKGROUND_LABELS[background] ?? background;
}

export function formatThemeLabel(themeId: string): string {
  if (!themeId) return 'Default';
  if (themeId === 'camel') return 'CAMEL';
  return themeId.charAt(0).toUpperCase() + themeId.slice(1);
}
