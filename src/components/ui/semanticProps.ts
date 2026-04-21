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

/**
 * Shared semantic color/chrome contract for reusable UI components.
 *
 * Axes:
 * - `variant`: component chrome pattern
 * - `emphasis`: visual intensity
 * - `tone`: semantic meaning
 */
export type UiVariant = 'primary' | 'secondary' | 'outline' | 'ghost';

export type UiEmphasis = 'subtle' | 'muted' | 'default' | 'strong' | 'inverse';

export type UiTone =
  | 'neutral'
  | 'success'
  | 'error'
  | 'information'
  | 'warning';

/**
 * Compatibility alias for older API surfaces that used `tone="default"`.
 * New code should prefer `tone="neutral"`.
 */
export type UiToneInput = UiTone | 'default';

export const DEFAULT_EMPHASIS_BY_VARIANT: Record<UiVariant, UiEmphasis> = {
  primary: 'default',
  secondary: 'subtle',
  outline: 'default',
  ghost: 'muted',
};

export function normalizeUiTone(tone?: UiToneInput): UiTone {
  return !tone || tone === 'default' ? 'neutral' : tone;
}
