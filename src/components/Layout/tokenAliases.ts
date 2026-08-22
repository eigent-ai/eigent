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

import type React from 'react';

type CssVarMap = React.CSSProperties & Record<`--${string}`, string>;

function asCssVarMap(map: Record<`--${string}`, string>): CssVarMap {
  return map as CssVarMap;
}

export function mergeLayoutAliasStyles(
  base: CssVarMap,
  style?: React.CSSProperties
): React.CSSProperties {
  return style ? ({ ...base, ...style } as React.CSSProperties) : base;
}

// Shared layout-level aliases for TopBar, HistorySidebar, and ProjectPageSidebar.
// Owner: design-system. Remove once Phase 7 usage is zero.
export const productLayoutTokenAliases = asCssVarMap({
  '--border-secondary': 'var(--ds-hairline-default-default)',
  '--border-disabled': 'var(--ds-hairline-subtle-default)',

  '--text-heading': 'var(--ds-ink-default-default)',
  '--text-body': 'var(--ds-ink-default-default)',
  '--text-label': 'var(--ds-ink-muted-default)',
  '--text-primary': 'var(--ds-ink-default-default)',
  '--text-secondary': 'var(--ds-ink-muted-default)',
  '--text-information': 'var(--ds-text-status-splitting-strong-default)',
  '--text-error': 'var(--ds-text-status-error-strong-default)',

  '--icon-primary': 'var(--ds-ink-default-default)',
  '--icon-secondary': 'var(--ds-ink-muted-default)',
  '--icon-information': 'var(--ds-icon-status-splitting-default-default)',
  '--icon-success': 'var(--ds-icon-status-completed-default-default)',
  '--icon-warning': 'var(--ds-icon-status-pending-default-default)',

  '--project-surface': 'var(--ds-neutral-default-default)',
  '--project-surface-hover': 'var(--ds-neutral-default-hover)',

  '--dropdown-bg': 'var(--ds-neutral-strong-default)',
  '--dropdown-border': 'var(--ds-hairline-default-default)',

  '--button-transparent-fill-default': 'transparent',
  '--button-transparent-fill-hover': 'var(--ds-neutral-default-hover)',
  '--button-transparent-text-default': 'var(--ds-ink-default-default)',
});
