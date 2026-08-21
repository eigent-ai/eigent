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

import {
  Bell as bellIcon,
  Blocks as blocksIcon,
  Bot as botIcon,
  Check as checkIcon,
  ChevronRight as chevronRightIcon,
  CircleHelp as circleHelpIcon,
  FileText as fileTextIcon,
  Folder as folderIcon,
  Globe2 as globeIcon,
  PanelLeft as panelLeftIcon,
  Play as playIcon,
  Plus as plusIcon,
  Search as searchIcon,
  Send as sendIcon,
  Settings as settingsIcon,
  Sparkles as sparklesIcon,
  TriangleAlert as triangleAlertIcon,
  UserRound as userRoundIcon,
  Workflow as workflowIcon,
  X as xIcon,
} from 'lucide';
import { marked } from 'marked';
import { canonicalD } from 'morphicons/dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

import {
  buildThemeV2,
  createDefaultThemeContractV2,
  DEFAULT_THEME_CATALOG,
  type Mode,
  type ResolvedThemeV2,
  type ThemeCatalogV2,
  type ThemeContractV2,
} from '../../../src/lib/themeTokens';
import { deltaEOK, hexToOklch } from '../../../src/lib/themeTokens/colorMath';

const { readFile, writeFile } = fs.promises;

type ViewerVersion = 'current' | 'proposed';

type ViewerConfig = {
  version: ViewerVersion;
  title: string;
  subtitle: string;
  status: string;
  observedLabel: string;
  markdownPath: string;
  outputPath: string;
  otherHref: string;
  otherLabel: string;
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const docsRoot = path.resolve(scriptDirectory, '..');
const compiledCssPath = path.join(docsRoot, 'viewer.generated.css');
const morphiconsDemoEntryPath = path.join(
  scriptDirectory,
  'morphicons-demo.ts'
);

const configs: ViewerConfig[] = [
  {
    version: 'current',
    title: 'Current token and CSS usage',
    subtitle:
      'An observed baseline of the styles, component recipes, exceptions, and inconsistencies implemented today.',
    status: 'Observed · non-normative',
    observedLabel: 'Branch design-system-enhancement · 21 Aug 2026',
    markdownPath: path.join(
      docsRoot,
      'current-token-usage',
      'CURRENT_STATE.md'
    ),
    outputPath: path.join(docsRoot, 'current-token-usage', 'baseline.html'),
    otherHref: '../new-design-system-plan/index.html',
    otherLabel: 'Open approved plan',
  },
  {
    version: 'proposed',
    title: 'Approved design system plan',
    subtitle:
      'The reviewed implementation plan for consistent color, type, icons, geometry, shape, borders, elevation, components, and future UI generation.',
    status: 'Plan · design review passed',
    observedLabel: 'Approved for staged implementation',
    markdownPath: path.join(docsRoot, 'new-design-system-plan', 'DESIGN.md'),
    outputPath: path.join(docsRoot, 'new-design-system-plan', 'index.html'),
    otherHref: '../current-token-usage/index.html',
    otherLabel: 'Review current usage',
  },
];

const toneFilter = new Set([
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
  'success',
  'warning',
  'error',
  'information',
]);

const elementFilter = new Set(['bg', 'text', 'border', 'icon', 'ring']);

const componentViewerTokens = new Set([
  '--bg-page',
  '--fill-fill-primary',
  '--fill-fill-secondary',
  '--text-heading',
  '--text-secondary',
  '--border-secondary',
  '--border-focus',
  '--dialog-overlay-scrim',
  '--terminal-viewport-surface',
  '--fill-browser',
  '--fill-document',
]);

function isViewerToken(name: string, version: ViewerVersion): boolean {
  if (version === 'current' && componentViewerTokens.has(name)) return true;
  if (name.startsWith('--ds-category-')) return true;
  return [...elementFilter].some((element) =>
    [...toneFilter].some((tone) => name.startsWith(`--ds-${element}-${tone}-`))
  );
}

const proposedEigentAccentSeeds = {
  light: '#1d1d1d',
  dark: '#ede1db',
} as const;
const proposedDefaultThemeId = 'eigent' as const;
const proposedThemeIds = [
  'eigent',
  'camel',
  'claw',
  'starfish',
  'whale',
  'custom',
] as const;
const proposedThemeLabels: Record<(typeof proposedThemeIds)[number], string> = {
  eigent: 'Eigent',
  camel: 'CAMEL',
  claw: 'Claw',
  starfish: 'Starfish',
  whale: 'Whale',
  custom: 'Custom',
};

const proposedThemeCatalog: ThemeCatalogV2 = {
  light: {
    ...DEFAULT_THEME_CATALOG.light,
    eigent: {
      ...DEFAULT_THEME_CATALOG.light.eigent,
      seed: {
        ...DEFAULT_THEME_CATALOG.light.eigent.seed,
        accent: proposedEigentAccentSeeds.light,
      },
    },
  },
  dark: {
    ...DEFAULT_THEME_CATALOG.dark,
    eigent: {
      ...DEFAULT_THEME_CATALOG.dark.eigent,
      seed: {
        ...DEFAULT_THEME_CATALOG.dark.eigent.seed,
        accent: proposedEigentAccentSeeds.dark,
      },
    },
  },
};

type CellOverrides = NonNullable<
  NonNullable<ThemeContractV2['overrides']>['cell']
>;

function proposedAccentStateCells(mode: Mode): CellOverrides {
  const cells: CellOverrides = {};
  const emphases = ['subtle', 'muted', 'default', 'strong'] as const;

  if (mode === 'dark') {
    const darkBaselineCell = {
      subtle: -0.67,
      muted: -0.39,
      default: -0.04,
      strong: 0.1,
    } as const;

    for (const emphasis of emphases) {
      const baseline = darkBaselineCell[emphasis];
      const emphasisChroma = emphasis === 'strong' ? -0.02 : 0;
      cells[`brand.${emphasis}.default`] = {
        dL: baseline,
        dC: emphasisChroma,
      };
      cells[`brand.${emphasis}.hover`] = {
        dL: baseline - 0.04,
        dC: emphasisChroma - 0.01,
      };
      cells[`brand.${emphasis}.selected`] = {
        dL: baseline - 0.04,
        dC: emphasisChroma - 0.015,
      };
      cells[`brand.${emphasis}.disabled`] = { dL: baseline - 0.08 };
    }

    return cells;
  }

  for (const emphasis of emphases) {
    const emphasisChroma = emphasis === 'strong' ? -0.02 : 0;
    const isStrong = emphasis === 'strong';
    // Cancel the engine's mode contrast bias at the row baseline, then move
    // only lightness for interaction. Lift the Strong row away from black so
    // its darker interaction states retain visible separation.
    cells[`brand.${emphasis}.default`] = {
      dL: isStrong ? 0.2 : 0.04,
      dC: emphasisChroma,
    };
    cells[`brand.${emphasis}.hover`] = {
      dL: isStrong ? 0.15 : 0,
      dC: emphasisChroma - 0.01,
    };
    cells[`brand.${emphasis}.selected`] = {
      dL: isStrong ? 0.12 : 0,
      dC: emphasisChroma - 0.015,
    };
  }

  return cells;
}

function proposedContract(mode: Mode): ThemeContractV2 {
  const base = createDefaultThemeContractV2(mode);
  const proposedNeutralStateCells: CellOverrides =
    mode === 'light'
      ? {
          'neutral.subtle.hover': { dL: -0.04 },
          'neutral.subtle.selected': { dL: -0.02 },
          'neutral.muted.hover': { dL: -0.04 },
          'neutral.muted.selected': { dL: -0.02 },
          'neutral.default.hover': { dL: -0.05 },
          'neutral.default.selected': { dL: -0.02 },
          'neutral.strong.hover': { dL: -0.04 },
          'neutral.strong.selected': { dL: -0.02 },
        }
      : {
          'neutral.subtle.hover': { dL: 0.04 },
          'neutral.subtle.selected': { dL: 0.02 },
          'neutral.muted.hover': { dL: 0.04 },
          'neutral.muted.selected': { dL: 0.02 },
          'neutral.default.hover': { dL: 0.05 },
          'neutral.default.selected': { dL: 0.02 },
          'neutral.strong.hover': { dL: 0.04 },
          'neutral.strong.selected': { dL: 0.02 },
        };

  return {
    ...base,
    themeId: proposedDefaultThemeId,
    overrides: {
      ...base.overrides,
      tone: {
        ...base.overrides?.tone,
        // The semantic brand tone currently injects chroma. Cancel that
        // addition so interaction states inherit the supplied seed exactly.
        brand: { dC: -0.03 },
      },
      cell: {
        ...base.overrides?.cell,
        ...proposedAccentStateCells(mode),
        ...proposedNeutralStateCells,
      },
    },
  };
}

function buildResolvedThemes(
  version: ViewerVersion
): Record<Mode, ResolvedThemeV2> {
  const resolved = {
    light: buildThemeV2(
      version === 'proposed'
        ? proposedContract('light')
        : createDefaultThemeContractV2('light'),
      version === 'proposed' ? proposedThemeCatalog : DEFAULT_THEME_CATALOG
    ),
    dark: buildThemeV2(
      version === 'proposed'
        ? proposedContract('dark')
        : createDefaultThemeContractV2('dark'),
      version === 'proposed' ? proposedThemeCatalog : DEFAULT_THEME_CATALOG
    ),
  };

  if (version === 'proposed') validateProposedAccentContract(resolved);
  return resolved;
}

function accentHex(
  resolved: ResolvedThemeV2,
  emphasis: (typeof proposedColorEmphasis)[number],
  state: 'default' | 'hover' | 'selected'
): `#${string}` {
  const name = `--ds-bg-brand-${emphasis}-${state}`;
  const value = resolved.cssVariables[name]?.toLowerCase();
  if (!value || !/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error(
      `Proposed Accent contract expected a hex value for ${name}`
    );
  }
  return value as `#${string}`;
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
}

function validateProposedAccentContract(
  resolved: Record<Mode, ResolvedThemeV2>
): void {
  const emphases = ['subtle', 'muted', 'default', 'strong'] as const;

  for (const mode of ['light', 'dark'] as const) {
    if (resolved[mode].contract.themeId !== proposedDefaultThemeId) {
      throw new Error(
        `Proposed primary matrices must default to ${proposedDefaultThemeId}; received ${resolved[mode].contract.themeId} in ${mode} mode`
      );
    }
  }

  for (const emphasis of emphases) {
    for (const mode of ['light', 'dark'] as const) {
      const base = hexToOklch(accentHex(resolved[mode], emphasis, 'default'));
      const hover = hexToOklch(accentHex(resolved[mode], emphasis, 'hover'));
      const selected = hexToOklch(
        accentHex(resolved[mode], emphasis, 'selected')
      );

      const hoverDelta = deltaEOK(base, hover);
      const selectedDelta = deltaEOK(base, selected);
      if (hoverDelta < 0.06) {
        throw new Error(
          `Proposed Accent ${mode}/${emphasis} default→hover is below ΔEOK 0.06 (${hoverDelta.toFixed(4)}; ${accentHex(resolved[mode], emphasis, 'default')} → ${accentHex(resolved[mode], emphasis, 'hover')})`
        );
      }
      if (selectedDelta < 0.08) {
        throw new Error(
          `Proposed Accent ${mode}/${emphasis} default→selected is below ΔEOK 0.08 (${selectedDelta.toFixed(4)})`
        );
      }
      if (
        base.c >= 0.02 &&
        (hueDistance(base.h, hover.h) > 1 ||
          hueDistance(base.h, selected.h) > 1)
      ) {
        throw new Error(
          `Proposed Accent ${mode}/${emphasis} interaction state rotates hue by more than 1°`
        );
      }
      if (base.c < 0.02 && (hover.c >= 0.02 || selected.c >= 0.02)) {
        throw new Error(
          `Proposed Accent ${mode}/${emphasis} interaction state injects chroma into a near-neutral Eigent seed`
        );
      }
      if (hover.l >= base.l || selected.l >= base.l) {
        throw new Error(
          `Proposed Accent ${mode}/${emphasis} interaction lightness moves in the wrong direction`
        );
      }
    }
  }

  for (const mode of ['light', 'dark'] as const) {
    const anchor = accentHex(resolved[mode], 'default', 'default');
    const expected = proposedEigentAccentSeeds[mode];
    if (anchor !== expected) {
      throw new Error(
        `Proposed Accent ${mode} anchor changed: expected ${expected}, received ${anchor}`
      );
    }
  }
}

function currentResolvedThemes(): Record<Mode, ResolvedThemeV2> {
  return {
    light: buildThemeV2(createDefaultThemeContractV2('light')),
    dark: buildThemeV2(createDefaultThemeContractV2('dark')),
  };
}

function defaultStateName(name: string): string | null {
  return name.replace(/-(hover|selected)$/, '-default');
}

function usesProposedColorGeneration(name: string): boolean {
  if (/^--ds-(bg|text|border|icon|ring)-brand-/.test(name)) return true;

  const isPublicChangedState = /-(hover|selected)$/.test(name);
  if (!isPublicChangedState) return false;

  return [
    '--ds-bg-neutral-',
    '--ds-border-neutral-',
    '--ds-ring-neutral-',
  ].some((prefix) => name.startsWith(prefix));
}

function tokenRules(version: ViewerVersion): string {
  const resolved = buildResolvedThemes(version);
  const current = currentResolvedThemes();

  const modeRule = (mode: Mode) => {
    const entries = Object.entries(resolved[mode].cssVariables)
      .filter(([name]) => isViewerToken(name, version))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, generatedValue]) => {
        let value = generatedValue;

        if (version === 'proposed' && !usesProposedColorGeneration(name)) {
          value = current[mode].cssVariables[name] ?? generatedValue;
        }

        if (
          version === 'proposed' &&
          (name.startsWith('--ds-text-') || name.startsWith('--ds-icon-')) &&
          !name.includes('-brand-')
        ) {
          const defaultName = defaultStateName(name);
          if (defaultName) {
            value = current[mode].cssVariables[defaultName] ?? value;
          }
        }

        return `  ${name}: ${value};`;
      })
      .join('\n');

    return `html[data-theme='${mode}'] {\n${entries}\n}`;
  };

  return `${modeRule('light')}\n\n${modeRule('dark')}`;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function metric(value: string, label: string): string {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function sectionHeading(
  index: string,
  title: string,
  description: string
): string {
  return `<div class="section-heading">
    <div><span class="section-eyebrow">${escapeHtml(index)}</span><h2>${escapeHtml(title)}</h2></div>
    <p>${escapeHtml(description)}</p>
  </div>`;
}

function specimen(
  title: string,
  note: string,
  body: string,
  options: { full?: boolean; bodyClass?: string } = {}
): string {
  return `<article class="specimen${options.full ? ' full' : ''}">
    <header class="specimen-header"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span></div></header>
    <div class="specimen-body${options.bodyClass ? ` ${options.bodyClass}` : ''}">${body}</div>
  </article>`;
}

function statusStrip(tone: 'brand' | 'neutral'): string {
  const states = [
    'default',
    'hover',
    'active',
    'selected',
    'focus',
    'disabled',
  ];
  return `<div class="status-strip">${states
    .map((state) => {
      const background = `var(--ds-bg-${tone}-default-${state})`;
      const text =
        tone === 'brand'
          ? 'var(--ds-text-brand-inverse-default)'
          : state === 'disabled'
            ? 'var(--ds-text-neutral-muted-disabled)'
            : 'var(--ds-text-neutral-default-default)';
      return `<div class="status-swatch" style="background:${background};--swatch-text:${text}"><strong>${state}</strong><span>bg.${tone}.default.${state}</span></div>`;
    })
    .join('')}</div>`;
}

const proposedColorEmphasis = ['subtle', 'muted', 'default', 'strong'] as const;
const proposedColorStates = [
  'default',
  'hover',
  'disabled',
  'selected',
] as const;

type ProposedColorFamily = {
  publicName: 'accent' | 'neutral' | 'ink' | 'hairline';
  title: string;
  responsibility: string;
  element: 'bg' | 'text' | 'border';
  tone: 'brand' | 'neutral';
  preview: 'fill' | 'ink' | 'hairline';
};

const proposedColorFamilies: ProposedColorFamily[] = [
  {
    publicName: 'accent',
    title: 'Accent (brand)',
    responsibility:
      'Brand identity, key actions, and selected accent surfaces.',
    element: 'bg',
    tone: 'brand',
    preview: 'fill',
  },
  {
    publicName: 'neutral',
    title: 'Neutral',
    responsibility: 'Canvas, panels, cards, fields, and neutral interaction.',
    element: 'bg',
    tone: 'neutral',
    preview: 'fill',
  },
  {
    publicName: 'ink',
    title: 'Ink (text)',
    responsibility: 'Text and icon hierarchy on approved surfaces.',
    element: 'text',
    tone: 'neutral',
    preview: 'ink',
  },
  {
    publicName: 'hairline',
    title: 'Hairline (border)',
    responsibility:
      'Boundaries, separators, and persistent selection reinforcement.',
    element: 'border',
    tone: 'neutral',
    preview: 'hairline',
  },
];

function proposedColorMatrix(family: ProposedColorFamily): string {
  const header = proposedColorStates
    .map((state) => `<div role="columnheader">${state}</div>`)
    .join('');
  const rows = proposedColorEmphasis
    .map((emphasis) => {
      const cells = proposedColorStates
        .map((state) => {
          const sourceToken = `${family.element}.${family.tone}.${emphasis}.${state}`;
          const publicToken = `${family.publicName}.${emphasis}.${state}`;
          const cssVariable = `--ds-${family.element}-${family.tone}-${emphasis}-${state}`;
          const sample = family.preview === 'ink' ? 'Aa' : '';

          return `<div class="color-token-cell" role="cell" aria-label="${publicToken}; backed by ${sourceToken}" style="--matrix-color:var(${cssVariable})">
            <div class="color-token-visual ${family.preview}" aria-hidden="true"><span>${sample}</span></div>
            <code>${emphasis}.${state}</code>
            <span>${sourceToken}</span>
          </div>`;
        })
        .join('');

      return `<div class="color-matrix-row" role="row">
        <div class="color-matrix-axis" role="rowheader"><strong>${emphasis}</strong><span>${family.publicName}.${emphasis}</span></div>
        ${cells}
      </div>`;
    })
    .join('');

  return `<section class="color-matrix-panel">
    <header><div><strong>${family.title}</strong><span>${family.responsibility}</span></div><code>${family.publicName}.{emphasis}.{state}</code></header>
    <div class="color-matrix-scroll" tabindex="0" aria-label="${family.title} color matrix">
      <div class="color-matrix" role="table" aria-label="${family.title}: four emphasis levels by four public states">
        <div class="color-matrix-row color-matrix-header" role="row">
          <div role="columnheader">emphasis</div>${header}
        </div>
        ${rows}
      </div>
    </div>
  </section>`;
}

function feedbackColors(): string {
  const roles = [
    ['Information', 'information', 'In progress or explanatory'],
    ['Success', 'success', 'Completed and valid'],
    ['Warning', 'warning', 'Attention without failure'],
    ['Error', 'error', 'Blocking or destructive'],
  ] as const;

  const lifecycleRoles = [
    ['Running', 'status-running'],
    ['Splitting', 'status-splitting'],
    ['Pending', 'status-pending'],
    ['Error', 'status-error'],
    ['Reassigning', 'status-reassigning'],
    ['Completed', 'status-completed'],
    ['Blocked', 'status-blocked'],
    ['Paused', 'status-paused'],
    ['Skipped', 'status-skipped'],
    ['Cancelled', 'status-cancelled'],
  ] as const;

  const feedback = `<div class="semantic-palette-grid">${roles
    .map(
      ([label, tone, description]) =>
        `<div class="semantic-color-card" style="--palette-bg:var(--ds-bg-${tone}-subtle-default);--palette-border:var(--ds-border-${tone}-default-default);--palette-ink:var(--ds-text-${tone}-strong-default)">
          <div class="semantic-color-swatch"><span aria-hidden="true"></span></div>
          <strong>${label}</strong><p>${description}</p><code>feedback.${tone}</code>
        </div>`
    )
    .join('')}</div>`;

  const lifecycle = `<div class="lifecycle-palette-grid">${lifecycleRoles
    .map(
      ([label, tone]) =>
        `<div class="lifecycle-color-card" style="--palette-bg:var(--ds-bg-${tone}-subtle-default);--palette-border:var(--ds-border-${tone}-default-default);--palette-ink:var(--ds-text-${tone}-strong-default)"><span class="lifecycle-color-mark" aria-hidden="true"></span><strong>${label}</strong><code>${tone.replace('status-', '')}</code></div>`
    )
    .join('')}</div>`;

  return `<div class="palette-stack"><section><header><strong>Core feedback</strong><span>Stable semantic meaning; separate from interaction state.</span></header>${feedback}</section><section><header><strong>Lifecycle status</strong><span>Existing fixed runtime roles remain visible and distinct.</span></header>${lifecycle}</section></div>`;
}

function categoryColors(): string {
  const colors = [
    'gray',
    'slate',
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'cyan',
    'teal',
    'indigo',
    'amber',
    'lime',
    'mint',
    'tomato',
  ];

  return `<div class="category-palette-grid">${colors
    .map(
      (color) =>
        `<div class="category-color-card" style="--category-bg:var(--ds-category-${color}-background-default);--category-border:var(--ds-category-${color}-border-default);--category-solid:var(--ds-category-${color}-solid-default);--category-ink:var(--ds-category-${color}-text-strong)">
          <div class="category-color-swatch"><span></span></div><strong>${color}</strong><code>category.${color}</code>
        </div>`
    )
    .join('')}</div>`;
}

function themeCatalogPreview(): string {
  return `<div class="theme-palette-grid">${proposedThemeIds
    .map((themeId) => {
      const light = proposedThemeCatalog.light[themeId]?.seed;
      const dark = proposedThemeCatalog.dark[themeId]?.seed;
      if (!light || !dark) {
        throw new Error(`Missing proposed theme seed for ${themeId}`);
      }
      const defaultBadge =
        themeId === proposedDefaultThemeId
          ? '<span class="theme-default-badge">Default matrix</span>'
          : '';
      const modePreview = (
        mode: Mode,
        seed: typeof light
      ) => `<div class="theme-mode-preview" style="--theme-accent:${seed.accent};--theme-background:${seed.background};--theme-ink:${seed.ink}">
          <div class="theme-mode-heading"><span>${mode}</span><code>${seed.accent}</code></div>
          <div class="theme-seed-demo"><span class="theme-accent-chip"></span><strong>Aa</strong></div>
          <div class="theme-seed-values"><span>background ${seed.background}</span><span>ink ${seed.ink}</span></div>
        </div>`;

      return `<article class="theme-palette-card" data-theme-id="${themeId}">
        <header><div><strong>${proposedThemeLabels[themeId]}</strong><code>theme.${themeId}</code></div>${defaultBadge}</header>
        <div class="theme-mode-grid">${modePreview('light', light)}${modePreview('dark', dark)}</div>
      </article>`;
    })
    .join('')}</div>`;
}

function currentOverview(): string {
  return `<section class="review-section" id="overview">
    ${sectionHeading('01 · Baseline', 'What exists today', 'The current system has a strong color engine, but other foundations and component recipes remain split across configuration, CSS, and local utilities.')}
    <div class="metric-grid">
      ${metric('4,860', 'semantic color addressable cells')}
      ${metric('23', 'type utilities with no generated CSS')}
      ${metric('325', 'arbitrary geometry utilities')}
      ${metric('338', 'shared Button instances')}
    </div>
    <div class="debt-callout mt-4"><span class="callout-mark">!</span><div><strong>Observed, not approved</strong><span>This page deliberately renders duplicate scales, missing recipes, and inconsistent component geometry. It is a baseline for comparison—not guidance for new UI.</span></div></div>
  </section>`;
}

function proposedOverview(): string {
  return `<section class="review-section" id="overview">
    ${sectionHeading('01 · Direction', 'One intent, one result', 'The proposal organizes reference values, semantic roles, complete component recipes, repeatable patterns, and a controlled exception registry.')}
    <div class="metric-grid">
      ${metric('4 + 1', 'token layers plus exceptions')}
      ${metric('3', 'named Markdown profiles')}
      ${metric('4', 'public color states per emphasis')}
      ${metric('1', 'source for CSS, Tailwind, types, and docs')}
    </div>
    <div class="proposal-callout mt-4"><span class="callout-mark">✓</span><div><strong>Design review passed</strong><span>The destination contract is approved. Production components migrate only through the staged implementation and verification gates.</span></div></div>
  </section>`;
}

function renderColors(version: ViewerVersion): string {
  if (version === 'current') {
    return `<section class="review-section" id="color">
      ${sectionHeading('02 · Foundation', 'Color and interaction', 'One global transform direction is applied in both modes; inspect dark mode to see why interaction separation needs refinement.')}
      <div class="spec-grid">
        ${specimen('Brand state matrix', 'Switch light/dark in the top bar', statusStrip('brand'), { full: true })}
        ${specimen('Neutral state matrix', 'The same six-state contract', statusStrip('neutral'), { full: true })}
        ${specimen(
          'Semantic feedback',
          'Status color is not an interaction state',
          `<div class="token-grid">
            <div class="token-card rounded-xl p-4" style="border-color:color-mix(in srgb,var(--viewer-success) 34%,transparent);background:color-mix(in srgb,var(--viewer-success) 10%,var(--viewer-surface))"><strong class="text-xs">Success</strong><p class="mt-2 text-xs text-[var(--viewer-text-muted)]">Completed and valid outcomes.</p></div>
            <div class="token-card rounded-xl p-4" style="border-color:color-mix(in srgb,var(--viewer-warning) 34%,transparent);background:color-mix(in srgb,var(--viewer-warning) 10%,var(--viewer-surface))"><strong class="text-xs">Warning</strong><p class="mt-2 text-xs text-[var(--viewer-text-muted)]">Attention without failure.</p></div>
            <div class="token-card rounded-xl p-4" style="border-color:color-mix(in srgb,var(--viewer-error) 34%,transparent);background:color-mix(in srgb,var(--viewer-error) 10%,var(--viewer-surface))"><strong class="text-xs">Error</strong><p class="mt-2 text-xs text-[var(--viewer-text-muted)]">Blocking or destructive outcomes.</p></div>
          </div>`,
          { full: true }
        )}
      </div>
    </section>`;
  }

  const matrixGallery = proposedColorFamilies
    .map((family) => proposedColorMatrix(family))
    .join('');

  return `<section class="review-section" id="color">
    ${sectionHeading('02 · Foundation', 'Color architecture', "Four primary groups, four emphasis levels, and four public states. Accent follows the active theme's mode seed; focus composes as a separate ring.")}
    <div class="color-contract-summary">
      <div><strong>4 primary groups</strong><span>Accent · Neutral · Ink · Hairline</span></div>
      <div><strong>4 emphasis levels</strong><span>Subtle · Muted · Default · Strong</span></div>
      <div><strong>4 public states</strong><span>Default · Hover · Disabled · Selected</span></div>
      <div><strong>Ring is separate</strong><span>Focus-visible composes over the current state</span></div>
    </div>
    <div class="spec-grid mt-4">
      ${specimen('Themes', 'Six catalog palettes; Eigent is the default for the Eigent Design System matrices', themeCatalogPreview(), { full: true, bodyClass: 'theme-specimen-body' })}
      ${specimen('Primary color matrices', `Eigent is active by default · ${proposedEigentAccentSeeds.light} in light and ${proposedEigentAccentSeeds.dark} in dark`, `<div class="color-matrix-gallery" data-primary-theme="${proposedDefaultThemeId}">${matrixGallery}</div>`, { full: true, bodyClass: 'color-specimen-body' })}
      ${specimen('Feedback colors', 'Fixed semantic meaning; never an interaction state', feedbackColors(), { full: true, bodyClass: 'color-specimen-body' })}
      ${specimen('Category colors', 'Identity and grouping; never success or error meaning', categoryColors(), { full: true, bodyClass: 'color-specimen-body' })}
    </div>
  </section>`;
}

const currentTypeRows = [
  ['heading-xl', 'The future starts here', '44 / 58 · bold'],
  ['heading-lg', 'Build with confidence', '36 / 46 · bold'],
  ['heading-base', 'A consistent foundation', '28 / 36 · bold'],
  ['heading-sm', 'Section heading', '24 / 32 · semibold'],
  [
    'body-lg',
    'Large body text for spacious product moments.',
    '20 / 30 · regular',
  ],
  [
    'body-md',
    'Default body text balances density and reading comfort.',
    '15 / 22 · regular',
  ],
  [
    'body-sm',
    'Compact product copy appears throughout the interface.',
    '13 / 20 · regular',
  ],
  ['label-xs', 'METADATA AND MICRO LABELS', '10 / 16 · semibold'],
];

const proposedTextRoles = [
  ['meta', 'Metadata and supporting detail', 11 / 13, 16 / 13],
  ['base', 'Default product text and controls', 1, 20 / 13],
  ['body-large', 'Comfortable reading text', 15 / 13, 22 / 13],
  ['title', 'Dialog and card title', 18 / 13, 24 / 13],
  ['section', 'Section heading', 20 / 13, 28 / 13],
  ['page', 'Page heading', 28 / 13, 36 / 13],
  ['display', 'Make complex work feel clear', 44 / 13, 52 / 13],
] as const;

const proposedCodeRoles = [
  ['small', 'Inline metadata and compact diffs', 12 / 13, 18 / 13],
  ['base', 'Default code, terminal, and diff text', 1, 20 / 13],
  ['large', 'Prominent code or terminal output', 15 / 13, 22 / 13],
] as const;

function typeRows(rows: string[][]): string {
  return `<div class="type-table">${rows
    .map(
      ([className, copy, meta]) => `<div class="type-row">
        <span class="type-label">${escapeHtml(className ?? '')}</span>
        <span class="type-sample ${escapeHtml(className ?? '')}">${escapeHtml(copy ?? '')}</span>
        <span class="type-meta">${escapeHtml(meta ?? '')}</span>
      </div>`
    )
    .join('')}</div>`;
}

function generatedTypeRows(
  channel: 'text' | 'code',
  roles: ReadonlyArray<readonly [string, string, number, number]>
): string {
  return roles
    .map(([role, copy, sizeRatio, lineRatio]) => {
      const size = Math.round(13 * sizeRatio);
      const line = Math.max(size, Math.round(13 * lineRatio));
      const ratio = sizeRatio.toFixed(2).replace(/\.00$/, '');
      return `<div class="generated-type-row" data-type-channel="${channel}" data-type-role="${role}" data-size-ratio="${sizeRatio}" data-line-ratio="${lineRatio}">
        <span class="generated-type-label">${channel}.${role}</span>
        <span class="generated-type-sample role-${role}" style="font-size:${size}px;line-height:${line}px">${escapeHtml(copy)}</span>
        <span class="generated-type-meta" data-type-meta>${size}/${line}px · ${ratio}×</span>
      </div>`;
    })
    .join('');
}

function proposedTypographyGenerator(): string {
  return `<div class="typography-generator" data-typography-generator>
    <div class="type-generator-reference"><strong>Codex-style controls, Eigent defaults</strong><span>Independent compact size inputs and family selectors; both Eigent base channels start at 13px.</span></div>
    <div class="type-generator-controls">
      <label class="type-generator-control"><span>Text font</span><select data-text-font aria-label="Text font family"><option value="inter">Inter</option><option value="system">System sans</option><option value="arial">Arial</option></select></label>
      <label class="type-generator-control"><span>Text base</span><span class="type-number-control"><input data-text-base type="number" min="11" max="16" step="1" value="13" aria-label="Text base font size"><span>px</span></span></label>
      <label class="type-generator-control"><span>Code font</span><select data-code-font aria-label="Code font family"><option value="sf-mono">SF Mono</option><option value="menlo">Menlo</option><option value="system-mono">System mono</option></select></label>
      <label class="type-generator-control"><span>Code base</span><span class="type-number-control"><input data-code-base type="number" min="8" max="24" step="1" value="13" aria-label="Code base font size"><span>px</span></span></label>
    </div>
    <div class="type-seed-summary" aria-live="polite">
      <div><span>Text seed</span><strong data-text-seed>Inter · 13px</strong><code>font.text + size.text.base</code></div>
      <div><span>Code seed</span><strong data-code-seed>SF Mono · 13px</strong><code>font.code + size.code.base</code></div>
      <button class="type-reset-button" type="button" data-type-reset>Reset 13 / 13</button>
    </div>
    <div class="generated-type-groups">
      <section class="generated-type-group text-channel" aria-labelledby="generated-text-ladder"><header><h3 id="generated-text-ladder">Generated text ladder</h3><span>One seed expands into seven semantic sizes.</span></header>${generatedTypeRows('text', proposedTextRoles)}</section>
      <section class="generated-type-group code-channel" aria-labelledby="generated-code-ladder"><header><h3 id="generated-code-ladder">Generated code ladder</h3><span>Code scales independently from its own seed.</span></header>${generatedTypeRows('code', proposedCodeRoles)}</section>
    </div>
  </div>`;
}

function renderTypography(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const callout = isCurrent
    ? `<div class="debt-callout mt-5"><span class="callout-mark">!</span><div><strong>Missing recipe becomes a browser fallback</strong><span>text-heading-2xl generates no CSS. On an h1, the legacy global rule expands it to 3.2em instead.</span></div></div>`
    : `<div class="proposal-callout mt-5"><span class="callout-mark">A</span><div><strong>Meaning and appearance are independent</strong><span>Choose the semantic element first, then its visual role. A compact h2 stays an h2; a styled div never substitutes for a heading.</span></div></div>`;

  return `<section class="review-section" id="typography">
    ${sectionHeading(
      '03 · Foundation',
      'Typography and semantic HTML',
      isCurrent
        ? 'Current recipes cover part of the product, while raw sizes, important overrides, global element rules, and visual div/span headings create drift.'
        : 'Two adjustable 13px seeds generate connected text and code ladders, while semantic HTML and component density remain independent.'
    )}
    ${specimen(isCurrent ? 'Implemented type recipes' : 'Typography generator', isCurrent ? 'Computed current values' : 'Change either 13px seed or font family to regenerate the connected preview', isCurrent ? typeRows(currentTypeRows) : proposedTypographyGenerator(), { full: true, bodyClass: isCurrent ? undefined : 'type-generator-body' })}
    ${callout}
  </section>`;
}

type IconInput = Parameters<typeof canonicalD>[0];

function iconSvg(
  icon: IconInput,
  size: number,
  strokeWidth: number,
  className = ''
): string {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${escapeHtml(canonicalD(icon))}"></path></svg>`;
}

function iconSampleGrid(
  samples: Array<[string, IconInput]>,
  size: number,
  strokeWidth: number
): string {
  return `<div class="icon-sample-grid">${samples
    .map(
      ([name, icon]) => `<div class="icon-sample-card">
        <div class="icon-sample-canvas">${iconSvg(icon, size, strokeWidth)}</div>
        <strong>${escapeHtml(name)}</strong>
        <code>${size}px / ${strokeWidth}px</code>
      </div>`
    )
    .join('')}</div>`;
}

const primaryIconSamples: Array<[string, IconInput]> = [
  ['Search', searchIcon],
  ['Add', plusIcon],
  ['Settings', settingsIcon],
  ['Folder', folderIcon],
  ['Profile', userRoundIcon],
  ['Notifications', bellIcon],
  ['Help', circleHelpIcon],
  ['Panel', panelLeftIcon],
];

const detailedIconSamples: Array<[string, IconInput]> = [
  ['Browser', globeIcon],
  ['Document', fileTextIcon],
  ['Agent', botIcon],
  ['Workflow', workflowIcon],
  ['AI action', sparklesIcon],
  ['Integrations', blocksIcon],
];

function morphControl(
  pair: 'play-pause' | 'send-check' | 'chevron-expand',
  label: string,
  description: string,
  initialIcon: IconInput
): string {
  return `<article class="morph-control-card">
    <button class="morph-control-button" type="button" data-morph-demo="${pair}" aria-label="${escapeHtml(label)}" aria-pressed="false">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path data-morph-path d="${escapeHtml(canonicalD(initialIcon))}"></path></svg>
      <span data-morph-label>${escapeHtml(label)}</span>
    </button>
    <div><strong>${escapeHtml(description)}</strong><code>${pair}</code></div>
  </article>`;
}

function proposedMorphControls(): string {
  return `<div class="morph-controls">
    ${morphControl('play-pause', 'Play', 'Playback toggle', playIcon)}
    ${morphControl('send-check', 'Send', 'Action completion', sendIcon)}
    ${morphControl('chevron-expand', 'Expand', 'Accordion state', chevronRightIcon)}
  </div>
  <div class="icon-code-recipe"><code>import { MorphIcon } from 'morphicons/react'</code><span>Change the Lucide icon data when state changes; use <code>reducedMotion="user"</code>.</span></div>`;
}

function renderIcons(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const currentSamples: Array<[string, IconInput]> = [
    ['12px', searchIcon],
    ['14px', plusIcon],
    ['16px', settingsIcon],
    ['20px', folderIcon],
    ['24px', bellIcon],
  ];

  return `<section class="review-section" id="icons">
    ${sectionHeading(
      '04 · Foundation',
      isCurrent ? 'Current icon usage' : 'Icons: two sizes, two styles',
      isCurrent
        ? 'Lucide is the dominant library, but local sizes and stroke weights are coupled to individual components.'
        : 'Lucide provides the base geometry. The 16px and 24px optical recipes keep scale and stroke intentional; Morphicons is reserved for state changes.'
    )}
    ${
      isCurrent
        ? specimen(
            'Observed size drift',
            'Representative local values without one optical contract',
            `<div class="current-icon-row">${currentSamples
              .map(
                ([label, icon]) =>
                  `<div>${iconSvg(
                    icon,
                    Number.parseInt(label, 10),
                    2
                  )}<span>${label}</span></div>`
              )
              .join('')}</div>`,
            { full: true }
          )
        : `<div class="icon-rule-summary">
            <div><strong>16px main</strong><span>Scales down to 12px · 1.25px stroke</span></div>
            <div><strong>24px detailed</strong><span>More room for detail · 1.5px stroke</span></div>
            <div><strong>Lucide base</strong><span>Static actions, objects, status, and navigation</span></div>
            <div><strong>Morphicons state</strong><span>One control changing meaning in place</span></div>
          </div>
          <div class="spec-grid mt-4">
            ${specimen('16px main grid', 'Default product icon; may scale to 12px without changing stroke intent', iconSampleGrid(primaryIconSamples, 16, 1.25), { full: true, bodyClass: 'icon-specimen-body' })}
            ${specimen('24px detailed grid', 'Use for feature moments, roomy navigation, and empty states', iconSampleGrid(detailedIconSamples, 24, 1.5), { full: true, bodyClass: 'icon-specimen-body' })}
            ${specimen('Dynamic state transforms', 'Click each control; the Lucide endpoints morph through the installed Morphicons runtime', proposedMorphControls(), { full: true, bodyClass: 'morph-specimen-body' })}
          </div>
          <div class="proposal-callout mt-5"><span class="callout-mark">i</span><div><strong>Morph meaning, not decoration</strong><span>Use Morphicons only when one control persists while its state or action changes. Different actions remain different buttons; static icons never animate merely on hover.</span></div></div>`
    }
  </section>`;
}

function scaleRows(values: Array<[string, number]>): string {
  const max = Math.max(...values.map(([, value]) => value));
  return `<div class="scale-list">${values
    .map(
      ([name, value]) =>
        `<div class="scale-row"><span class="scale-name">${escapeHtml(name)}</span><span class="scale-track"><span class="scale-bar" style="display:block;width:${Math.max(2, (value / max) * 100)}%"></span></span><span class="scale-value">${value}px</span></div>`
    )
    .join('')}</div>`;
}

function currentControlLadder(): string {
  return `<div class="control-ladder">
    <button class="demo-button current-xs" type="button">20</button>
    <button class="demo-button current-sm" type="button">24</button>
    <button class="demo-button current-md" type="button">28</button>
    <button class="demo-button current-lg" type="button">32</button>
    <button class="demo-button current-xl primary" type="button">36</button>
    <div class="demo-field current">Field · 40</div>
    <div class="demo-field current textarea">Textarea · 60</div>
  </div>`;
}

function proposedControlLadder(): string {
  return `<div class="proposal-surface control-ladder">
    <div class="demo-layout-row-stack">
      <div class="demo-layout-row-header">
        <h3 class="demo-layout-row-title">Panel header · 40</h3>
        <button class="demo-layout-row-action" type="button">${iconSvg(plusIcon, 16, 1.25, 'button-icon')}Action · 28</button>
      </div>
      <div class="demo-layout-row-header prominent">
        <h3 class="demo-layout-row-title">Key page header · 48</h3>
        <button class="demo-layout-row-action medium" type="button">${iconSvg(plusIcon, 16, 1.25, 'button-icon')}Action · 32</button>
      </div>
    </div>
    <div class="control-ladder-actions">
      <button class="demo-icon-button" type="button" aria-label="Add">${iconSvg(plusIcon, 16, 1.25, 'button-icon')}</button>
      <button class="demo-button" type="button">${iconSvg(plusIcon, 16, 1.25, 'button-icon')}Secondary</button>
      <button class="demo-button primary smooth-shadow-xs" type="button">${iconSvg(sparklesIcon, 16, 1.25, 'button-icon')}Primary action</button>
      <div class="demo-field">Associated field label</div>
    </div>
  </div>`;
}

function renderSpacing(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const values: Array<[string, number]> = isCurrent
    ? [
        ['spacing-xs', 4],
        ['spacing-sm', 8],
        ['spacing-md', 16],
        ['spacing-lg', 32],
        ['spacing-xl', 64],
      ]
    : [
        ['space-0', 0],
        ['space-2', 2],
        ['space-4', 4],
        ['space-6', 6],
        ['space-8', 8],
        ['space-12', 12],
        ['space-16', 16],
        ['space-20', 20],
        ['space-24', 24],
        ['space-32', 32],
        ['space-40', 40],
        ['space-48', 48],
        ['space-64', 64],
      ];

  return `<section class="review-section" id="spacing">
    ${sectionHeading(
      '05 · Geometry',
      'Spacing and control scale',
      isCurrent
        ? 'Five named aliases duplicate numeric Tailwind values while common 12, 20, and 24px gaps are unnamed. Controls use unrelated height ladders.'
        : 'Reference spacing is complete enough for real UI, while semantic recipes scale type, icon, gap, padding, height, and radius together.'
    )}
    <div class="spec-grid">
      ${specimen(isCurrent ? 'Named spacing aliases' : 'Reference spacing', isCurrent ? '4 / 8 / 16 / 32 / 64' : 'Nominal pixels at a 16px root', scaleRows(values))}
      ${specimen(isCurrent ? 'Current component heights' : 'One complete control recipe', isCurrent ? 'Button and field systems do not align' : 'Use the density switch in the top bar', isCurrent ? currentControlLadder() : proposedControlLadder())}
    </div>
  </section>`;
}

function radiusSample(name: string, value: string, radius: string): string {
  return `<div class="radius-sample" style="border-radius:${radius}"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(value)}</span></div></div>`;
}

function renderRadius(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const samples = isCurrent
    ? [
        ['rounded', '4px', '4px'],
        ['rounded-sm', '4px duplicate', '4px'],
        ['rounded-md', '6px', '6px'],
        ['rounded-lg', '8px', '8px'],
        ['rounded-xl', '16px', '16px'],
        ['rounded-2xl', '16px duplicate', '16px'],
        ['rounded-3xl', '24px', '24px'],
        ['rounded-full', '9999px', '9999px'],
      ]
    : [
        ['nested', '4px', '4px'],
        ['row', '8px', '8px'],
        ['message', '12px + tail', '12px 12px 4px 12px'],
        ['card', '16px', '16px'],
        ['panel', '24px', '24px'],
        ['primary action', 'full', '9999px'],
        ['icon control', 'circle/full', '9999px'],
      ];

  return `<section class="review-section" id="radius">
    ${sectionHeading(
      '06 · Shape',
      'Radius roles',
      isCurrent
        ? 'Utility names imply distinctions that are not visible, while surfaces and controls choose radii independently.'
        : 'The proposal is pill-first for key interaction, but keeps panels, cards, nested surfaces, and directional messages structurally distinct.'
    )}
    ${specimen(isCurrent ? 'Resolved utility scale' : 'Semantic shape roles', isCurrent ? 'Duplicate values are intentionally visible' : 'Approved role mapping', `<div class="radius-grid">${samples.map(([name, value, radius]) => radiusSample(name ?? '', value ?? '', radius ?? '0')).join('')}</div>`, { full: true })}
  </section>`;
}

function renderBorders(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  return `<section class="review-section" id="borders">
    ${sectionHeading(
      '07 · Definition',
      'Borders and focus',
      isCurrent
        ? 'Hairlines, one-pixel borders, strong edges, and four focus widths coexist without one semantic contract.'
        : 'Container borders, separators, validation outlines, and keyboard focus become separate composable roles.'
    )}
    <div class="spec-grid">
      ${specimen(
        isCurrent ? 'Observed widths' : 'Proposed border roles',
        isCurrent
          ? 'Meaning is inferred from local usage'
          : 'Hairline / thin / strong / accent',
        `<div class="border-stack">
          <div class="border-sample" style="border-width:.5px"><span>${isCurrent ? 'Half-pixel' : 'Hairline'}</span><code>.5px</code></div>
          <div class="border-sample" style="border-width:1px"><span>${isCurrent ? 'Default' : 'Thin'}</span><code>1px</code></div>
          <div class="border-sample" style="border-width:2px"><span>${isCurrent ? 'Strong / state' : 'Strong'}</span><code>2px</code></div>
          <div class="border-sample" style="border-width:4px"><span>${isCurrent ? 'Accent / blockquote' : 'Accent'}</span><code>4px</code></div>
        </div>`
      )}
      ${specimen(
        isCurrent ? 'Observed focus widths' : 'One focus-visible contract',
        isCurrent
          ? '1 / 2 / 3 / 4px appear in product source'
          : '3px soft ring, separate from layout border',
        `<div class="focus-demo">
          ${isCurrent ? '<div class="focus-box ring-1">1px</div><div class="focus-box ring-2">2px</div><div class="focus-box ring-3">3px</div><div class="focus-box ring-4">4px</div>' : '<div class="focus-box ring-3">focus</div><div class="focus-box" style="border-color:var(--viewer-error);box-shadow:0 0 0 3px color-mix(in srgb,var(--viewer-ring) 28%,transparent)">error + focus</div>'}
        </div>`
      )}
    </div>
  </section>`;
}

function renderShadows(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const cards = isCurrent
    ? [
        ['shadow-sm', 'stock', 'current-shadow-sm'],
        ['shadow-md', 'stock', 'current-shadow-md'],
        ['shadow-lg', 'stock', 'current-shadow-lg'],
        ['shadow-perfect', 'custom multilayer', 'current-shadow-perfect'],
        ['button-shadow', 'inset + drop + outline', 'current-shadow-button'],
      ]
    : [
        ['control', 'smooth-shadow-xs', 'smooth-shadow-xs'],
        ['card', 'smooth-shadow-sm', 'smooth-shadow-sm'],
        ['floating', 'smooth-shadow-md', 'smooth-shadow-md'],
        ['popover', 'smooth-shadow-ring-md', 'smooth-shadow-ring-md'],
        ['dialog', 'smooth-shadow-ring-lg', 'smooth-shadow-ring-lg'],
      ];

  return `<section class="review-section" id="elevation">
    ${sectionHeading(
      '08 · Depth',
      'Elevation and shadow',
      isCurrent
        ? 'Stock Tailwind, custom perfect/soft, button, direct CSS, and an undefined shadow token are mixed across the app.'
        : 'Semantic elevation maps to shadow-plugin output. Ring variants replace—not duplicate—a separate border on floating surfaces.'
    )}
    ${specimen(
      isCurrent ? 'Current shadow families' : 'Proposed semantic elevation',
      isCurrent
        ? 'Physical class names leak into components'
        : 'Rendered with shadow-plugin 2.1.0 on Tailwind 4',
      `<div class="elevation-grid">${cards
        .map(
          ([name, value, className]) =>
            `<div class="elevation-sample ${className}"><div><strong>${name}</strong><span>${value}</span></div></div>`
        )
        .join('')}</div>`,
      { full: true, bodyClass: 'checker' }
    )}
  </section>`;
}

function currentComponentStage(): string {
  return `<div class="component-stage">
    <div class="demo-dialog current-dialog">
      <h3>Mixed component recipes</h3>
      <p>Input and textarea share a form but not the same radius, size ladder, label semantics, or shadow treatment.</p>
      <div class="demo-form">
        <div><div class="mb-1 text-xs font-semibold text-[var(--viewer-text-strong)]">Visual title rendered as div</div><div class="demo-field current w-full">Workspace name</div></div>
        <div><div class="mb-1 text-xs font-semibold text-[var(--viewer-text-strong)]">Another visual title</div><div class="demo-field current textarea w-full">Add a description…</div></div>
      </div>
      <div class="dialog-actions"><button class="demo-button current-lg" type="button">Cancel</button><button class="demo-button current-xl primary current-shadow-button" type="button">Save workspace</button></div>
    </div>
  </div>`;
}

function proposedComponentStage(): string {
  return `<div class="component-stage proposal-surface">
    <div class="demo-dialog proposal-dialog smooth-shadow-ring-lg">
      <h3>Create a workspace</h3>
      <p>One recipe aligns labels, fields, validation, actions, focus, radius, spacing, and elevation.</p>
      <form class="demo-form">
        <label for="workspace-name">Workspace name<input id="workspace-name" required placeholder="e.g. Product research" /></label>
        <label for="workspace-description">Description<textarea id="workspace-description" placeholder="What will this workspace help you do?"></textarea></label>
      </form>
      <div class="dialog-actions"><button class="demo-button" type="button">Cancel</button><button class="demo-button primary smooth-shadow-xs" type="button">Create workspace</button></div>
    </div>
  </div>`;
}

function proposedButtonComponents(): string {
  const leadingIcon = iconSvg(plusIcon, 16, 1.25, 'button-icon');
  const variants = [
    {
      name: 'Text',
      value: 'text',
      description: 'Inline action with no container at rest.',
      tokens: 'ink.default · underline on hover',
    },
    {
      name: 'Ghost',
      value: 'ghost',
      description: 'Transparent pill that reveals Neutral interaction fill.',
      tokens: 'neutral.subtle · ink.default',
    },
    {
      name: 'Outline',
      value: 'outline',
      description: 'Transparent pill with a persistent Hairline.',
      tokens: 'hairline.default · ink.default',
    },
    {
      name: 'Secondary',
      value: 'secondary',
      description: 'Neutral filled action for supporting hierarchy.',
      tokens: 'neutral.default · ink.default',
    },
    {
      name: 'Primary',
      value: 'primary',
      description: 'Strong Accent fill reserved for the main action.',
      tokens: 'accent.strong · ink.inverse',
    },
  ] as const;

  const rows = variants
    .map(
      ({
        name,
        value,
        description,
        tokens,
      }) => `<div class="button-style-row" role="row">
        <div class="button-style-name" role="rowheader"><strong>${name}</strong><span>${description}</span><code>variant="${value}"</code></div>
        <div class="button-style-cell" role="cell"><button class="proposal-button button-${value}" type="button">${leadingIcon}Button</button></div>
        <div class="button-style-cell" role="cell"><button class="proposal-button button-${value} is-hovered" type="button">${leadingIcon}Button</button></div>
        <div class="button-style-cell" role="cell"><button class="proposal-button button-${value}" type="button" disabled>${leadingIcon}Button</button></div>
        <code class="button-style-tokens" role="cell">${tokens}</code>
      </div>`
    )
    .join('');

  return `<div class="button-component-system proposal-surface">
    <div class="button-matrix-scroll">
      <div class="button-style-matrix" role="table" aria-label="Proposed button variants and states">
        <div class="button-style-header" role="row"><span role="columnheader">Style</span><span role="columnheader">Default</span><span role="columnheader">Hover</span><span role="columnheader">Disabled</span><span role="columnheader">Recipe</span></div>
        ${rows}
      </div>
    </div>
    <section class="confirm-button-panel" aria-labelledby="confirm-button-title">
      <header><div><h3 id="confirm-button-title">Custom confirmation buttons</h3><p>Use Feedback tone only when the confirmation carries that outcome; shape and sizing remain the standard Button recipe.</p></div><code>variant="primary" + tone</code></header>
      <div class="confirm-button-grid">
        <article><span>Positive confirmation</span><button class="proposal-button button-confirm confirm-success" type="button">${iconSvg(checkIcon, 16, 1.25, 'button-icon')}Confirm changes</button><code>tone="success"</code></article>
        <article><span>Risk confirmation</span><button class="proposal-button button-confirm confirm-warning" type="button">${iconSvg(triangleAlertIcon, 16, 1.25, 'button-icon')}Continue anyway</button><code>tone="warning"</code></article>
        <article><span>Destructive confirmation</span><button class="proposal-button button-confirm confirm-error" type="button">${iconSvg(xIcon, 16, 1.25, 'button-icon')}Delete workspace</button><code>tone="error"</code></article>
      </div>
    </section>
  </div>`;
}

function renderComponents(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  return `<section class="review-section" id="components">
    ${sectionHeading(
      '09 · Recipes',
      'Component system',
      isCurrent
        ? 'Shared primitives exist, but native buttons, parallel MenuButton geometry, local form surfaces, and visual-only titles bypass a complete contract.'
        : 'Each primitive owns semantics and every visual axis. Feature code chooses intent, size, state, and content rather than rebuilding chrome.'
    )}
    ${isCurrent ? '' : specimen('Button component styles', 'Text, ghost, outline, secondary, primary, and semantic confirmation treatments', proposedButtonComponents(), { full: true, bodyClass: 'button-specimen-body' })}
    ${specimen(isCurrent ? 'Observed form and dialog' : 'Proposed form and dialog', isCurrent ? 'Representative inconsistency, not one literal screen' : 'Semantic labels + complete recipes + plugin elevation', isCurrent ? currentComponentStage() : proposedComponentStage(), { full: true })}
  </section>`;
}

function renderMarkdownProfiles(version: ViewerVersion): string {
  const isCurrent = version === 'current';
  const profiles = isCurrent
    ? [
        [
          'Chat/document CSS',
          'Paragraphs unexpectedly reset from a 14px wrapper to 13/20.',
          'marked + sanitized HTML',
        ],
        [
          'Workflow React map',
          'Every heading is 13/20 and differs mostly by weight.',
          'ReactMarkdown',
        ],
        [
          'Summary renderer',
          'A third implementation appears unreferenced.',
          'apparently inactive',
        ],
      ]
    : [
        [
          'Document',
          'Comfortable prose hierarchy for complete answers and durable documents.',
          'shared renderer',
        ],
        [
          'Chat compact',
          'Tighter rhythm for questions, responses, and inline task context.',
          'shared tokens',
        ],
        [
          'Work log',
          'Dense operational detail with legible code, tables, and state.',
          'shared semantics',
        ],
      ];

  return `<section class="review-section" id="markdown">
    ${sectionHeading(
      '10 · Content',
      'Markdown profiles',
      isCurrent
        ? 'Two active renderers and one apparently inactive renderer carry unrelated type, spacing, table, and heading rules.'
        : 'One semantic renderer supports three density profiles without forking typography or accessibility behavior.'
    )}
    <div class="markdown-profiles">${profiles
      .map(
        ([title, copy, meta], index) =>
          `<article class="markdown-profile"><h3>${title}</h3><p>${copy}</p>${index === 0 ? '<ul><li>Consistent headings</li><li>Readable paragraphs</li><li><code>inline code</code> and tables</li></ul>' : ''}<p><code>${meta}</code></p></article>`
      )
      .join('')}</div>
  </section>`;
}

function renderGuideline(markdownHtml: string, version: ViewerVersion): string {
  return `<section class="review-section" id="guideline">
    ${sectionHeading(
      '11 · Reference',
      version === 'current'
        ? 'Full current-state DESIGN.md'
        : 'Full proposed DESIGN.md',
      version === 'current'
        ? 'The complete observed audit, source map, debt register, exceptions, and review questions.'
        : 'The complete candidate architecture, token contracts, migration rules, exception registry, and adoption gates.'
    )}
    <div class="document-shell"><article class="doc">${markdownHtml}</article></div>
  </section>`;
}

const navItems = [
  ['overview', 'Overview'],
  ['color', 'Color'],
  ['typography', 'Typography'],
  ['icons', 'Icons'],
  ['spacing', 'Spacing & controls'],
  ['radius', 'Radius'],
  ['borders', 'Borders & focus'],
  ['elevation', 'Elevation'],
  ['components', 'Components'],
  ['markdown', 'Markdown'],
  ['guideline', 'Full guideline'],
];

function sidebar(config: ViewerConfig): string {
  return `<aside class="viewer-sidebar">
    <div class="viewer-wordmark"><span class="viewer-mark">E</span><span>Eigent DS</span></div>
    <div class="viewer-version"><strong>${escapeHtml(config.version === 'current' ? 'Current baseline' : 'Proposed system')}</strong><span>${escapeHtml(config.status)}</span></div>
    <nav class="viewer-nav" aria-label="Design system sections">${navItems.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav>
    <div class="viewer-sidebar-footer"><a class="version-link" href="${config.otherHref}"><span>${escapeHtml(config.otherLabel)}</span><span aria-hidden="true">→</span></a></div>
  </aside>`;
}

function topbar(config: ViewerConfig): string {
  const density =
    config.version === 'proposed'
      ? `<div class="segmented" role="group" aria-label="Preview density">
          <button type="button" data-density-value="compact" aria-pressed="false">Compact</button>
          <button type="button" data-density-value="default" aria-pressed="true">Default</button>
          <button type="button" data-density-value="comfortable" aria-pressed="false">Comfortable</button>
        </div>`
      : '';

  return `<header class="viewer-topbar">
    <div class="topbar-meta"><strong>${escapeHtml(config.title)}</strong><span>${escapeHtml(config.observedLabel)}</span></div>
    <div class="topbar-controls">
      ${density}
      <div class="segmented" role="group" aria-label="Preview theme">
        <button type="button" data-theme-value="light" aria-pressed="true">Light</button>
        <button type="button" data-theme-value="dark" aria-pressed="false">Dark</button>
        <button type="button" data-theme-value="system" aria-pressed="false">System</button>
      </div>
    </div>
  </header>`;
}

function hero(config: ViewerConfig): string {
  const tailwindLabel =
    config.version === 'current'
      ? 'Tailwind 3.4 baseline'
      : 'Tailwind 4.3.3 trial';

  return `<section class="viewer-hero" aria-labelledby="viewer-title">
    <span class="hero-kicker">${escapeHtml(config.status)}</span>
    <h1 id="viewer-title">${escapeHtml(config.title)}</h1>
    <p>${escapeHtml(config.subtitle)}</p>
    <div class="hero-meta"><span class="meta-chip">${escapeHtml(tailwindLabel)}</span><span class="meta-chip">Theme Tokens V2</span><span class="meta-chip">Light + dark</span>${config.version === 'proposed' ? '<span class="meta-chip">Lucide + Morphicons</span><span class="meta-chip">shadow-plugin 2.1.0</span>' : ''}</div>
  </section>`;
}

function clientScript(version: ViewerVersion): string {
  return `<script>
    (() => {
      const root = document.documentElement;
      const themeButtons = [...document.querySelectorAll('[data-theme-value]')];
      const densityButtons = [...document.querySelectorAll('[data-density-value]')];
      const systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
      let selectedTheme = localStorage.getItem('eigent-design-viewer-theme') || 'light';

      const resolvedTheme = () => selectedTheme === 'system' ? (systemQuery.matches ? 'dark' : 'light') : selectedTheme;
      const applyTheme = () => {
        root.dataset.theme = resolvedTheme();
        themeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeValue === selectedTheme)));
      };

      themeButtons.forEach((button) => button.addEventListener('click', () => {
        selectedTheme = button.dataset.themeValue || 'light';
        localStorage.setItem('eigent-design-viewer-theme', selectedTheme);
        applyTheme();
      }));

      systemQuery.addEventListener('change', () => {
        if (selectedTheme === 'system') applyTheme();
      });

      densityButtons.forEach((button) => button.addEventListener('click', () => {
        const density = button.dataset.densityValue || 'default';
        root.dataset.density = density;
        densityButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
      }));

      const typographyGenerator = document.querySelector('[data-typography-generator]');
      if (typographyGenerator) {
        const textBaseInput = typographyGenerator.querySelector('[data-text-base]');
        const codeBaseInput = typographyGenerator.querySelector('[data-code-base]');
        const textFontSelect = typographyGenerator.querySelector('[data-text-font]');
        const codeFontSelect = typographyGenerator.querySelector('[data-code-font]');
        const textSeed = typographyGenerator.querySelector('[data-text-seed]');
        const codeSeed = typographyGenerator.querySelector('[data-code-seed]');
        const resetButton = typographyGenerator.querySelector('[data-type-reset]');
        const textFonts = {
          inter: "'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          system: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          arial: 'Arial, Helvetica, sans-serif'
        };
        const codeFonts = {
          'sf-mono': "ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Monaco, Consolas, monospace",
          menlo: 'Menlo, Monaco, Consolas, monospace',
          'system-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace'
        };

        const readSize = (input, fallback) => {
          const parsed = Number(input.value);
          const minimum = Number(input.min);
          const maximum = Number(input.max);
          const value = Number.isFinite(parsed) ? parsed : fallback;
          return Math.min(maximum, Math.max(minimum, Math.round(value)));
        };

        const updateTypography = (commitValues = false) => {
          const textBase = readSize(textBaseInput, 13);
          const codeBase = readSize(codeBaseInput, 13);
          const textFont = textFonts[textFontSelect.value] || textFonts.inter;
          const codeFont = codeFonts[codeFontSelect.value] || codeFonts['sf-mono'];

          if (commitValues) {
            textBaseInput.value = String(textBase);
            codeBaseInput.value = String(codeBase);
          }

          typographyGenerator.style.setProperty('--type-text-font', textFont);
          typographyGenerator.style.setProperty('--type-code-font', codeFont);
          root.style.setProperty('--proposal-text-font', textFont);
          root.style.setProperty('--proposal-code-font', codeFont);
          root.style.setProperty('--proposal-text-base', textBase + 'px');
          root.style.setProperty('--proposal-code-base', codeBase + 'px');
          root.style.setProperty('--proposal-text-meta-size', Math.max(10, Math.round(textBase * 11 / 13)) + 'px');
          root.style.setProperty('--proposal-text-meta-line', Math.max(textBase, Math.round(textBase * 16 / 13)) + 'px');
          root.style.setProperty('--proposal-text-base-line', Math.max(textBase, Math.round(textBase * 20 / 13)) + 'px');
          root.style.setProperty('--proposal-text-body-large-size', Math.max(11, Math.round(textBase * 15 / 13)) + 'px');
          root.style.setProperty('--proposal-text-body-large-line', Math.max(textBase, Math.round(textBase * 22 / 13)) + 'px');
          root.style.setProperty('--proposal-text-title-size', Math.max(11, Math.round(textBase * 18 / 13)) + 'px');
          root.style.setProperty('--proposal-text-title-line', Math.max(textBase, Math.round(textBase * 24 / 13)) + 'px');
          root.style.setProperty('--proposal-code-base-line', Math.max(codeBase, Math.round(codeBase * 20 / 13)) + 'px');
          root.style.setProperty('--proposal-control-compact-line', Math.max(textBase, Math.round(textBase * 16 / 13)) + 'px');

          typographyGenerator.querySelectorAll('[data-type-channel]').forEach((row) => {
            const channel = row.dataset.typeChannel;
            const base = channel === 'code' ? codeBase : textBase;
            const floor = channel === 'code' ? 8 : row.dataset.typeRole === 'meta' ? 10 : 11;
            const sizeRatio = Number(row.dataset.sizeRatio) || 1;
            const lineRatio = Number(row.dataset.lineRatio) || 1;
            const size = Math.max(floor, Math.round(base * sizeRatio));
            const line = Math.max(size, Math.round(base * lineRatio));
            const sample = row.querySelector('.generated-type-sample');
            const meta = row.querySelector('[data-type-meta]');
            const ratio = sizeRatio.toFixed(2).replace(/\\.00$/, '');
            sample.style.fontSize = size + 'px';
            sample.style.lineHeight = line + 'px';
            meta.textContent = size + '/' + line + 'px · ' + ratio + '×';
          });

          textSeed.textContent = textFontSelect.options[textFontSelect.selectedIndex].text + ' · ' + textBase + 'px';
          codeSeed.textContent = codeFontSelect.options[codeFontSelect.selectedIndex].text + ' · ' + codeBase + 'px';
        };

        [textBaseInput, codeBaseInput].forEach((input) => {
          input.addEventListener('input', () => updateTypography(false));
          input.addEventListener('blur', () => updateTypography(true));
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') input.blur();
          });
        });
        [textFontSelect, codeFontSelect].forEach((select) => select.addEventListener('change', () => updateTypography(false)));
        resetButton.addEventListener('click', () => {
          textBaseInput.value = '13';
          codeBaseInput.value = '13';
          textFontSelect.selectedIndex = 0;
          codeFontSelect.selectedIndex = 0;
          updateTypography(true);
        });
        updateTypography(true);
      }

      document.querySelectorAll('.doc table').forEach((table) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrap';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      });

      document.querySelectorAll('.doc a').forEach((link) => {
        if (link.href.startsWith('http')) {
          link.target = '_blank';
          link.rel = 'noreferrer';
        }
      });

      const navLinks = [...document.querySelectorAll('.viewer-nav a')];
      const sections = navLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach((link) => link.setAttribute('aria-current', String(link.getAttribute('href') === '#' + visible.target.id)));
      }, { rootMargin: '-15% 0px -68% 0px', threshold: [0, 0.1, 0.5] });
      sections.forEach((section) => observer.observe(section));

      root.dataset.density = root.dataset.density || 'default';
      root.dataset.version = '${version}';
      applyTheme();
    })();
  </script>`;
}

async function buildMorphiconsDemoBundle(): Promise<string> {
  const result = (await viteBuild({
    configFile: false,
    logLevel: 'silent',
    build: {
      target: 'es2020',
      minify: true,
      write: false,
      rollupOptions: {
        input: morphiconsDemoEntryPath,
        output: {
          format: 'iife',
          name: 'EigentMorphiconsDemo',
          inlineDynamicImports: true,
        },
      },
    },
  })) as {
    output: Array<{
      type: 'asset' | 'chunk';
      isEntry?: boolean;
      code?: string;
    }>;
  };

  const entry = result.output.find(
    (item) => item.type === 'chunk' && item.isEntry
  );
  if (!entry?.code) {
    throw new Error('Morphicons viewer bundle did not produce an entry chunk');
  }

  return entry.code.replaceAll('</script', '<\\/script');
}

async function buildViewer(
  config: ViewerConfig,
  compiledCss: string,
  morphiconsBundle: string
): Promise<void> {
  const markdown = stripFrontmatter(
    await readFile(config.markdownPath, 'utf8')
  );
  const markdownHtml = await marked.parse(markdown, { gfm: true });
  const sections = [
    config.version === 'current' ? currentOverview() : proposedOverview(),
    renderColors(config.version),
    renderTypography(config.version),
    renderIcons(config.version),
    renderSpacing(config.version),
    renderRadius(config.version),
    renderBorders(config.version),
    renderShadows(config.version),
    renderComponents(config.version),
    renderMarkdownProfiles(config.version),
    renderGuideline(markdownHtml, config.version),
  ].join('\n');

  const html = `<!doctype html>
<html lang="en" data-theme="light" data-density="default" data-version="${config.version}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(config.subtitle)}" />
  <title>${escapeHtml(config.title)} · Eigent</title>
  <style>${compiledCss}</style>
  <style>${tokenRules(config.version)}</style>
</head>
<body>
  <div class="design-viewer ${config.version === 'proposed' ? 'proposal-surface' : 'current-surface'}">
    <div class="viewer-layout">
      ${sidebar(config)}
      <div class="viewer-content">
        ${topbar(config)}
        <main class="viewer-main">
          ${hero(config)}
          ${sections}
          <p class="footer-note">${config.version === 'proposed' ? 'Generated from new-design-system-plan/DESIGN.md · Approved implementation plan' : 'Generated from current-token-usage/CURRENT_STATE.md · Observed baseline'}</p>
        </main>
      </div>
    </div>
  </div>
  ${clientScript(config.version)}
  ${config.version === 'proposed' ? `<script data-morphicons-runtime="1">${morphiconsBundle}</script>` : ''}
</body>
</html>`;

  await writeFile(config.outputPath, html, 'utf8');
  process.stdout.write(
    `Built ${path.relative(repositoryRoot, config.outputPath)}\n`
  );
}

async function main(): Promise<void> {
  const [compiledCss, morphiconsBundle] = await Promise.all([
    readFile(compiledCssPath, 'utf8'),
    buildMorphiconsDemoBundle(),
  ]);
  for (const config of configs) {
    await buildViewer(config, compiledCss, morphiconsBundle);
  }
}

await main();
