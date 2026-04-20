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

export const THEME_CONTRACT_VERSION = 2 as const;

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
export const TOKEN_TONES = [
  'neutral',
  'brand',
  'status-running',
  'status-splitting',
  'status-pending',
  'status-error',
  'status-reassigning',
  'status-completed',
  'status-blocked',
  'status-paused',
  'status-skipped',
  'status-cancelled',
  'single-agent',
  'workforce',
  'browser',
  'terminal',
  'document',
  'success',
  'caution',
  'error',
  'warning',
  'information',
] as const;

export type Mode = 'light' | 'dark';

export type Element = (typeof TOKEN_ELEMENTS)[number];
export type Emphasis = (typeof TOKEN_EMPHASIS)[number];
export type State = (typeof TOKEN_UI_STATES)[number];
export type Tone = (typeof TOKEN_TONES)[number];
export type TokenKey = `${Element}.${Tone}.${Emphasis}.${State}`;

export type Adjustment = {
  dL?: number;
  dC?: number;
  dH?: number;
  alpha?: number;
};

export type ThemeContractV2 = {
  version: typeof THEME_CONTRACT_VERSION;
  mode: Mode;
  themeId: string;
  contrast: number; // 0..100
  overrides?: {
    tone?: Partial<Record<Tone, Adjustment>>;
    emphasis?: Partial<Record<Emphasis, Adjustment>>;
    state?: Partial<Record<State, Adjustment>>;
    cell?: Partial<Record<`${Tone}.${Emphasis}.${State}`, Adjustment>>;
  };
};

export type TokenGenerationContractV2 = {
  baseToneAdjustments?: Partial<Record<Tone, Adjustment>>;
  emphasisAdjustments?: Partial<Record<Emphasis, Adjustment>>;
  stateAdjustments?: Partial<Record<State, Adjustment>>;
  requiredContrastPairs?: Array<{
    fg: TokenKey;
    bg: TokenKey;
    minContrast: number;
    largeText?: boolean;
  }>;
};

export type ThemeSeedV2 = {
  accent: `#${string}`;
  background: `#${string}`;
  ink: `#${string}`;
};

export type ColorThemeDefinitionV2 = {
  id: string;
  mode: Mode;
  seed: ThemeSeedV2;
};

export type ThemeCatalogV2 = Record<
  Mode,
  Record<string, ColorThemeDefinitionV2>
>;

export type ThemeTokens = Partial<Record<TokenKey, string>>;

export type ContrastDiagnostic = {
  fg: TokenKey;
  bg: TokenKey;
  ratio: number;
  minRequired: number;
  passes: boolean;
  apcaLc: number;
};

export type ThemeDiagnostics = {
  contrast: ContrastDiagnostic[];
};

export type ResolvedThemeV2 = {
  contract: ThemeContractV2;
  seed: ThemeSeedV2;
  tokens: ThemeTokens;
  cssVariables: Record<string, string>;
  diagnostics: ThemeDiagnostics;
};

// Backward-compatible type aliases during V2 cutover.
export type ThemeSeed = ThemeSeedV2;
export type ThemeCatalog = ThemeCatalogV2;
export type UiState = State;
