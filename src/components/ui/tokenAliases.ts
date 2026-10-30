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

export function mergeAliasStyles(
  base: CssVarMap,
  style?: React.CSSProperties
): React.CSSProperties {
  return style ? ({ ...base, ...style } as React.CSSProperties) : base;
}

// Compatibility aliases for primitives that still read legacy --input-* / --button-*
// CSS variables. Owner: design-system. Remove once Phase 7 usage is zero.
export const formControlTokenAliases = asCssVarMap({
  '--input-bg-default': 'var(--ds-neutral-default-default)',
  '--input-bg-hover': 'var(--ds-neutral-default-hover)',
  '--input-bg-input': 'var(--ds-neutral-strong-default)',
  '--input-bg-confirm': 'var(--ds-bg-success-subtle-default)',
  '--input-border-default': 'var(--ds-hairline-default-default)',
  '--input-border-hover': 'var(--ds-hairline-strong-default)',
  '--input-border-focus': 'var(--ds-ring-focus)',
  '--input-border-success': 'var(--ds-border-success-default-default)',
  '--input-text-default': 'var(--ds-ink-default-default)',
  '--input-text-focus': 'var(--ds-ink-default-default)',
  '--input-label-default': 'var(--ds-ink-muted-default)',
  '--text-heading': 'var(--ds-ink-default-default)',
  '--text-body': 'var(--ds-ink-default-default)',
  '--text-label': 'var(--ds-ink-muted-default)',
  '--text-success': 'var(--ds-text-success-strong-default)',
  '--text-information': 'var(--ds-text-information-strong-default)',
  '--text-inverse-primary': 'var(--ds-ink-inverse)',
  '--icon-primary': 'var(--ds-ink-default-default)',
  '--menutabs-fill-hover': 'var(--ds-neutral-default-hover)',
});

export const buttonTokenAliases = asCssVarMap({
  '--button-primary-fill-default': 'var(--ds-accent-strong-default)',
  '--button-primary-fill-hover': 'var(--ds-accent-strong-hover)',
  '--button-primary-fill-disabled': 'var(--ds-accent-strong-disabled)',
  '--button-primary-text-default': 'var(--ds-ink-inverse)',
  '--button-primary-text-hover': 'var(--ds-ink-inverse)',
  '--button-primary-text-disabled': 'var(--ds-ink-muted-disabled)',

  '--button-secondary-fill-default': 'var(--ds-neutral-muted-default)',
  '--button-secondary-fill-hover': 'var(--ds-neutral-muted-hover)',
  '--button-secondary-fill-disabled': 'var(--ds-neutral-muted-disabled)',
  '--button-secondary-text-default': 'var(--ds-ink-default-default)',
  '--button-secondary-text-hover': 'var(--ds-ink-default-default)',
  '--button-secondary-text-disabled': 'var(--ds-ink-muted-disabled)',

  '--button-tertiary-fill-default': 'var(--ds-neutral-subtle-default)',
  '--button-tertiary-fill-hover': 'var(--ds-neutral-subtle-hover)',
  '--button-tertiary-fill-disabled': 'var(--ds-neutral-subtle-disabled)',
  '--button-tertiary-text-default': 'var(--ds-ink-default-default)',
  '--button-tertiary-text-hover': 'var(--ds-ink-default-default)',
  '--button-tertiary-text-disabled': 'var(--ds-ink-muted-disabled)',

  '--button-fill-success': 'var(--ds-bg-success-strong-default)',
  '--button-fill-success-foreground': 'var(--ds-success-on-strong)',
  '--fill-fill-success-hover': 'var(--ds-bg-success-subtle-hover)',

  '--button-fill-error': 'var(--ds-bg-error-strong-default)',
  '--button-fill-error-foreground': 'var(--ds-error-on-strong)',

  '--button-fill-information': 'var(--ds-bg-information-strong-default)',
  '--button-fill-information-foreground': 'var(--ds-information-on-strong)',

  '--button-fill-warning': 'var(--ds-bg-warning-strong-default)',
  '--button-fill-warning-foreground': 'var(--ds-warning-on-strong)',
});

export const tagTokenAliases = asCssVarMap({
  '--tag-fill-info': 'var(--ds-bg-information-subtle-default)',
  '--tag-foreground-info': 'var(--ds-text-information-strong-default)',
  '--tag-fill-success': 'var(--ds-bg-success-subtle-default)',
  '--tag-foreground-success': 'var(--ds-text-success-strong-default)',
  '--tag-fill-warning': 'var(--ds-bg-warning-subtle-default)',
  '--tag-foreground-warning': 'var(--ds-text-warning-strong-default)',
  '--tag-fill-default': 'var(--ds-neutral-default-default)',
  '--tag-foreground-default': 'var(--ds-ink-default-default)',
});

export const checkboxTokenAliases = asCssVarMap({
  '--input-border-default': 'var(--ds-hairline-default-default)',
  '--input-bg-default': 'var(--ds-neutral-default-default)',
  '--input-border-hover': 'var(--ds-hairline-strong-default)',
  '--switch-on-fill-track-fill': 'var(--ds-bg-success-default-default)',
  '--switch-on-fill-thumb-fill': 'var(--ds-success-indicator-on-default)',
});

export const switchTokenAliases = asCssVarMap({
  '--switch-on-fill-track-fill': 'var(--ds-bg-success-default-default)',
  '--switch-off-fill-track-fill': 'var(--ds-neutral-subtle-default)',
  '--switch-on-fill-thumb-fill': 'var(--ds-success-indicator-on-default)',
});

export const tooltipTokenAliases = asCssVarMap({
  '--border-secondary': 'var(--ds-hairline-default-default)',
  '--text-primary': 'var(--ds-ink-default-default)',
});
