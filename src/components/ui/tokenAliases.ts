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

export const formControlTokenAliases = asCssVarMap({
  '--input-bg-default': 'var(--ds-bg-neutral-default-default)',
  '--input-bg-hover': 'var(--ds-bg-neutral-default-hover)',
  '--input-bg-input': 'var(--ds-bg-neutral-strong-default)',
  '--input-bg-confirm': 'var(--ds-bg-status-completed-subtle-default)',
  '--input-border-default': 'var(--ds-border-neutral-default-default)',
  '--input-border-hover': 'var(--ds-border-neutral-strong-default)',
  '--input-border-focus': 'var(--ds-border-brand-default-focus)',
  '--input-border-success': 'var(--ds-border-status-completed-default-default)',
  '--input-border-caution': 'var(--ds-border-status-error-default-default)',
  '--input-text-default': 'var(--ds-text-neutral-default-default)',
  '--input-text-focus': 'var(--ds-text-neutral-default-default)',
  '--input-label-default': 'var(--ds-text-neutral-muted-default)',
  '--text-heading': 'var(--ds-text-neutral-default-default)',
  '--text-body': 'var(--ds-text-neutral-default-default)',
  '--text-label': 'var(--ds-text-neutral-muted-default)',
  '--text-success': 'var(--ds-text-status-completed-strong-default)',
  '--text-caution': 'var(--ds-text-status-error-strong-default)',
  '--text-information': 'var(--ds-text-status-splitting-strong-default)',
  '--icon-primary': 'var(--ds-icon-neutral-default-default)',
  '--menutabs-fill-hover': 'var(--ds-bg-neutral-default-hover)',
});

export const buttonTokenAliases = asCssVarMap({
  '--button-primary-fill-default': 'var(--ds-bg-brand-default-default)',
  '--button-primary-fill-hover': 'var(--ds-bg-brand-default-hover)',
  '--button-primary-fill-active': 'var(--ds-bg-brand-default-active)',
  '--button-primary-fill-disabled': 'var(--ds-bg-neutral-muted-disabled)',
  '--button-primary-text-default': 'var(--ds-text-brand-inverse-default)',
  '--button-primary-text-hover': 'var(--ds-text-brand-inverse-default)',
  '--button-primary-text-active': 'var(--ds-text-brand-inverse-default)',
  '--button-primary-text-disabled': 'var(--ds-text-neutral-muted-disabled)',

  '--button-secondary-fill-default': 'var(--ds-bg-neutral-default-default)',
  '--button-secondary-fill-hover': 'var(--ds-bg-neutral-default-hover)',
  '--button-secondary-fill-active': 'var(--ds-bg-neutral-default-active)',
  '--button-secondary-fill-disabled': 'var(--ds-bg-neutral-muted-disabled)',
  '--button-secondary-text-default': 'var(--ds-text-neutral-default-default)',
  '--button-secondary-text-hover': 'var(--ds-text-neutral-default-default)',
  '--button-secondary-text-active': 'var(--ds-text-neutral-default-default)',
  '--button-secondary-text-disabled': 'var(--ds-text-neutral-muted-disabled)',

  '--button-tertiary-fill-default': 'var(--ds-bg-neutral-subtle-default)',
  '--button-tertiary-fill-hover': 'var(--ds-bg-neutral-default-hover)',
  '--button-tertiary-fill-active': 'var(--ds-bg-neutral-default-active)',
  '--button-tertiary-fill-disabled': 'var(--ds-bg-neutral-muted-disabled)',
  '--button-tertiary-text-default': 'var(--ds-text-neutral-default-default)',
  '--button-tertiary-text-hover': 'var(--ds-text-neutral-default-default)',
  '--button-tertiary-text-active': 'var(--ds-text-neutral-default-default)',
  '--button-tertiary-text-disabled': 'var(--ds-text-neutral-muted-disabled)',

  '--button-transparent-fill-default': 'transparent',
  '--button-transparent-fill-hover': 'var(--ds-bg-neutral-default-hover)',
  '--button-transparent-fill-active': 'var(--ds-bg-neutral-default-active)',
  '--button-transparent-fill-disabled': 'transparent',
  '--button-transparent-text-default': 'var(--ds-text-neutral-default-default)',
  '--button-transparent-text-hover': 'var(--ds-text-neutral-default-default)',
  '--button-transparent-text-active': 'var(--ds-text-neutral-default-default)',
  '--button-transparent-text-disabled': 'var(--ds-text-neutral-muted-disabled)',

  '--button-fill-success': 'var(--ds-bg-status-completed-default-default)',
  '--button-fill-success-foreground':
    'var(--ds-text-status-completed-strong-default)',
  '--fill-fill-success-hover': 'var(--ds-bg-status-completed-subtle-hover)',
  '--fill-fill-success-active': 'var(--ds-bg-status-completed-default-default)',

  '--button-fill-caution': 'var(--ds-bg-status-error-default-default)',
  '--button-fill-caution-foreground':
    'var(--ds-text-status-error-strong-default)',

  '--button-fill-information': 'var(--ds-bg-status-splitting-default-default)',
  '--button-fill-information-foreground':
    'var(--ds-text-status-splitting-strong-default)',

  '--button-fill-warning': 'var(--ds-bg-status-pending-default-default)',
  '--button-fill-warning-foreground':
    'var(--ds-text-status-pending-strong-default)',
});

export const tagTokenAliases = asCssVarMap({
  '--tag-fill-info': 'var(--ds-bg-status-splitting-subtle-default)',
  '--tag-foreground-info': 'var(--ds-text-status-splitting-strong-default)',
  '--tag-fill-success': 'var(--ds-bg-status-completed-subtle-default)',
  '--tag-foreground-success': 'var(--ds-text-status-completed-strong-default)',
  '--tag-fill-warning': 'var(--ds-bg-status-pending-subtle-default)',
  '--tag-foreground-warning': 'var(--ds-text-status-pending-strong-default)',
  '--tag-fill-caution': 'var(--ds-bg-status-error-subtle-default)',
  '--tag-foreground-caution': 'var(--ds-text-status-error-strong-default)',
  '--tag-fill-default': 'var(--ds-bg-neutral-default-default)',
  '--tag-foreground-default': 'var(--ds-text-neutral-default-default)',
});

export const checkboxTokenAliases = asCssVarMap({
  '--input-border-default': 'var(--ds-border-neutral-default-default)',
  '--input-bg-default': 'var(--ds-bg-neutral-default-default)',
  '--input-border-hover': 'var(--ds-border-neutral-strong-default)',
  '--switch-on-fill-track-fill':
    'var(--ds-bg-status-completed-default-default)',
  '--switch-on-fill-thumb-fill': 'var(--ds-text-brand-inverse-default)',
});

export const switchTokenAliases = asCssVarMap({
  '--switch-on-fill-track-fill':
    'var(--ds-bg-status-completed-default-default)',
  '--switch-off-fill-track-fill': 'var(--ds-bg-neutral-default-default)',
  '--switch-on-fill-thumb-fill': 'var(--ds-text-brand-inverse-default)',
});

export const tooltipTokenAliases = asCssVarMap({
  '--border-secondary': 'var(--ds-border-neutral-default-default)',
  '--text-primary': 'var(--ds-text-neutral-default-default)',
});
