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

export const THEME_CONTRACT_VERSION = 1 as const;

export const TOKEN_ELEMENTS = ['bg', 'text', 'border', 'icon', 'ring'] as const;
export const TOKEN_EMPHASIS = [
  'subtle',
  'muted',
  'default',
  'strong',
  'inverse',
] as const;
export const TOKEN_UI_STATES = [
  'default',
  'hover',
  'active',
  'selected',
  'focus',
  'disabled',
] as const;

export const TASK_SEMANTIC_STATES = [
  'running',
  'splitting',
  'pending',
  'error',
  'reassigning',
  'completed',
  'blocked',
  'paused',
  'skipped',
  'cancelled',
] as const;

export const FIXED_TONES = [
  'single-agent',
  'workforce',
  'browser',
  'terminal',
  'document',
  'success',
  'caution',
  'warning',
  'information',
] as const;

export type Mode = 'light' | 'dark';

export type ThemeContractV1 = {
  version: typeof THEME_CONTRACT_VERSION;
  mode: Mode;
  colorThemeId: string;
  contrast: number; // 0..100
};

export type ThemeSeed = {
  accent: `#${string}`;
  background: `#${string}`;
  ink: `#${string}`;
};

export type ColorThemeDefinitionV1 = {
  id: string;
  mode: Mode;
  seed: ThemeSeed;
};

export type ThemeCatalog = Record<Mode, Record<string, ColorThemeDefinitionV1>>;

export type Element = (typeof TOKEN_ELEMENTS)[number];
export type Emphasis = (typeof TOKEN_EMPHASIS)[number];
export type UiState = (typeof TOKEN_UI_STATES)[number];
export type TaskSemanticState = (typeof TASK_SEMANTIC_STATES)[number];
export type StatusTone = `status-${TaskSemanticState}`;
export type FixedTone = (typeof FIXED_TONES)[number];
export type Tone = 'neutral' | 'brand' | StatusTone | FixedTone;
export type TokenKey = `${Element}.${Tone}.${Emphasis}.${UiState}`;

export type ThemeTokens = Partial<Record<TokenKey, string>>;

export type ResolvedThemeV1 = {
  contract: ThemeContractV1;
  seed: ThemeSeed;
  tokens: ThemeTokens;
  cssVariables: Record<string, string>;
};
