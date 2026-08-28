// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0.
//
// Deterministic generator for design-system CSS, Tailwind mappings, and types.
// Hand-authored JSON in src/style/tokens is the source of truth.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const tokensDirectory = path.join(repositoryRoot, 'src', 'style', 'tokens');
const outputDirectory = path.join(repositoryRoot, 'src', 'style', 'generated');

function readJson(filename) {
  return JSON.parse(readFileSync(path.join(tokensDirectory, filename), 'utf8'));
}

function pxToRem(px) {
  if (px === 0) return '0';
  const rem = px / 16;
  return Number.isInteger(rem) ? `${rem}rem` : `${rem}rem`;
}

function roundRole(basePx, ratio, floorPx) {
  return Math.max(floorPx, Math.round(basePx * ratio));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`generate-design-tokens: ${message}`);
  }
}

const referenceDimension = readJson('reference.dimension.json');
const referenceTypography = readJson('reference.typography.json');
const semanticDimension = readJson('semantic.dimension.json');
const semanticElevation = readJson('semantic.elevation.json');
const componentRecipe = readJson('component.recipe.json');
const toneAssignment = readJson('tone.assignment.json');
const exceptionRegistry = readJson('exception.registry.json');
const colorManifest = readJson('manifest.json');
const fontStacks = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, 'src', 'style', 'fontStacks.json'),
    'utf8'
  )
);

/** @type {Map<string, { cssVar: string, value: string, layer: string }>} */
const tokens = new Map();
const cssVarToId = new Map();

function defineToken(id, cssVar, value, layer) {
  assert(!tokens.has(id), `Duplicate token id "${id}"`);
  assert(!cssVarToId.has(cssVar), `Duplicate CSS variable "${cssVar}"`);
  assert(
    typeof value === 'string' && value.length > 0,
    `Token "${id}" is missing a value`
  );
  if (layer === 'reference' || layer === 'semantic') {
    assert(
      value === '0' ||
        value === 'none' ||
        /^-?\d+(\.\d+)?(px|rem|em)$/.test(value) ||
        value.includes(' ') ||
        value.startsWith('var(') ||
        /^[0-9]+$/.test(value) ||
        value.includes(',') ||
        value.includes('"'),
      `Token "${id}" has an invalid value "${value}"`
    );
  }
  tokens.set(id, { cssVar, value, layer });
  cssVarToId.set(cssVar, id);
}

function referenceLookup(id) {
  const token = tokens.get(id);
  assert(token, `Unknown reference "${id}"`);
  return token;
}

function resolveAlias(raw) {
  const match = String(raw).match(/^\{([a-z0-9.-]+)\}$/i);
  if (!match) return raw;
  const target = referenceLookup(match[1]);
  return `var(${target.cssVar})`;
}

function walkObject(object, visit, prefix = []) {
  for (const [key, value] of Object.entries(object)) {
    if (key.startsWith('$')) continue;
    const pathParts = [...prefix, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      walkObject(value, visit, pathParts);
      continue;
    }
    visit(pathParts, value);
  }
}

for (const [step, value] of Object.entries(referenceDimension.space)) {
  defineToken(
    `ref.space.${step}`,
    `--ds-ref-space-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.radius)) {
  defineToken(
    `ref.radius.${step}`,
    `--ds-ref-radius-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.controlHeight)) {
  defineToken(
    `ref.controlHeight.${step}`,
    `--ds-ref-control-height-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.layoutRow)) {
  defineToken(
    `ref.layoutRow.${step}`,
    `--ds-ref-layout-row-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.iconSize)) {
  defineToken(
    `ref.iconSize.${step}`,
    `--ds-ref-icon-size-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.iconStroke)) {
  defineToken(
    `ref.iconStroke.${step}`,
    `--ds-ref-icon-stroke-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.border)) {
  defineToken(
    `ref.border.${step}`,
    `--ds-ref-border-${step}`,
    value,
    'reference'
  );
}
for (const [step, value] of Object.entries(referenceDimension.focus)) {
  defineToken(
    `ref.focus.${step}`,
    `--ds-ref-focus-${step}`,
    value,
    'reference'
  );
}

for (const [name, value] of Object.entries(referenceTypography.weights)) {
  defineToken(`ref.weight.${name}`, `--ds-weight-${name}`, value, 'reference');
}

defineToken(
  'ref.font.text',
  '--ds-font-text',
  referenceTypography.families.text
    .map((family) => (family.includes(' ') ? `"${family}"` : family))
    .join(', '),
  'reference'
);
defineToken(
  'ref.font.code',
  '--ds-font-code',
  (fontStacks.code ?? referenceTypography.families.code)
    .map((family) => (family.includes(' ') ? `"${family}"` : family))
    .join(', '),
  'reference'
);

const textChannel = referenceTypography.channels.text;
const codeChannel = referenceTypography.channels.code;

function emitRole(channel, role, spec, floorPx) {
  const basePx =
    channel === 'text' ? textChannel.defaultPx : codeChannel.defaultPx;
  const resolvedSize = roundRole(basePx, spec.sizeRatio, floorPx);
  const resolvedLine = Math.max(
    resolvedSize,
    Math.round(basePx * spec.lineRatio)
  );
  defineToken(
    `role.${channel}.${role}.size`,
    `--ds-${channel}-${role}-size`,
    pxToRem(resolvedSize),
    'semantic'
  );
  defineToken(
    `role.${channel}.${role}.line`,
    `--ds-${channel}-${role}-line`,
    pxToRem(resolvedLine),
    'semantic'
  );
  return { sizePx: resolvedSize, linePx: resolvedLine };
}

const typographyRoles = {};
for (const [role, spec] of Object.entries(referenceTypography.roles.text)) {
  const floor =
    role === 'meta' ? textChannel.metaFloorPx : textChannel.generalFloorPx;
  typographyRoles[`text.${role}`] = emitRole('text', role, spec, floor);
}
for (const [role, spec] of Object.entries(referenceTypography.roles.code)) {
  typographyRoles[`code.${role}`] = emitRole(
    'code',
    role,
    spec,
    codeChannel.floorPx
  );
}

walkObject(semanticDimension, (parts, value) => {
  const id = parts.join('.');
  const cssVar = `--ds-${parts.join('-')}`;
  defineToken(id, cssVar, resolveAlias(value), 'semantic');
});

for (const [role, value] of Object.entries(semanticElevation.roles)) {
  defineToken(`elevation.${role}`, `--ds-elevation-${role}`, value, 'semantic');
}

const aliasPattern = /\{([a-z0-9.-]+)\}/gi;
function resolveRecipeValue(value) {
  if (typeof value !== 'string') return value;
  return value.replace(aliasPattern, (_, id) => {
    const token = tokens.get(id);
    assert(token, `Recipe references unknown token "${id}"`);
    return `var(${token.cssVar})`;
  });
}

function recipeCssVar(parts) {
  const skipped = parts.filter(
    (part, index) => !(index === 1 && part === 'sizes')
  );
  return `--ds-${skipped
    .join('-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()}`;
}

walkObject(componentRecipe, (parts, value) => {
  if (typeof value !== 'string') return;
  if (parts[0] === 'button' && parts[1] === 'variants') return;
  if (parts[0] === 'button' && parts[1] === 'compat') return;
  aliasPattern.lastIndex = 0;
  const id = parts.join('.');
  if (
    aliasPattern.test(value) ||
    /rem|px|%$/.test(value) ||
    value.startsWith('{')
  ) {
    aliasPattern.lastIndex = 0;
    defineToken(id, recipeCssVar(parts), resolveRecipeValue(value), 'recipe');
  }
});

const assignedTones = Object.entries(toneAssignment.families)
  .filter(([, assignment]) => assignment.kind !== 'retired')
  .map(([tone]) => tone)
  .sort();
const manifestTones = [...colorManifest.tones].sort();
assert(
  assignedTones.length === manifestTones.length &&
    assignedTones.every((tone, index) => tone === manifestTones[index]),
  `Every shipping manifest tone must have a non-retired assignment. assigned=[${assignedTones.join(',')}] manifest=[${manifestTones.join(',')}]`
);
for (const [tone, assignment] of Object.entries(toneAssignment.families)) {
  if (assignment.kind === 'retired') {
    assert(
      !colorManifest.tones.includes(tone),
      `Retired tone "${tone}" must not be published by the manifest`
    );
  }
}
assert(
  Array.isArray(exceptionRegistry.exceptions) &&
    exceptionRegistry.exceptions.length > 0,
  'Exception registry must list approved exceptions'
);

const cssLines = [
  '/* GENERATED FILE. Do not edit. Source: src/style/tokens/*.json */',
  '/* Generated by scripts/generate-design-tokens.mjs */',
  '',
  ':root {',
];

const orderedTokens = [...tokens.entries()].sort(([left], [right]) =>
  left.localeCompare(right)
);
for (const [, token] of orderedTokens) {
  cssLines.push(`  ${token.cssVar}: ${token.value};`);
}

cssLines.push(
  '  --ds-text-base-px: 13;',
  '  --ds-code-base-px: 13;',
  '  --font-text: var(--ds-font-text);',
  '  --font-code: var(--ds-font-code);',
  '  --spacing-xs: var(--ds-ref-space-4);',
  '  --spacing-sm: var(--ds-ref-space-8);',
  '  --spacing-md: var(--ds-ref-space-16);',
  '  --spacing-lg: var(--ds-ref-space-32);',
  '  --spacing-xl: var(--ds-ref-space-64);',
  '  --borderRadius-sm: var(--ds-ref-radius-4);',
  '  --borderRadius-lg: var(--ds-ref-radius-8);',
  '  --borderRadius-xl: var(--ds-ref-radius-16);',
  '  --fontSize-sm: var(--ds-text-base-size);',
  '  --fontWeight-regular: var(--ds-weight-regular);',
  '  --fontWeight-medium: var(--ds-weight-medium);',
  '  --fontWeight-semibold: var(--ds-weight-semibold);',
  '  --fontWeight-bold: var(--ds-weight-bold);',
  '  --shadow-ds-elevation-control: var(--ds-elevation-control);',
  '}',
  ''
);

const spacing = {};
const borderRadius = {};
const boxShadow = {};
const fontSize = {};
const fontFamily = {
  text: 'var(--ds-font-text)',
  code: 'var(--ds-font-code)',
};
const fontWeight = {
  regular: 'var(--ds-weight-regular)',
  medium: 'var(--ds-weight-medium)',
  semibold: 'var(--ds-weight-semibold)',
  bold: 'var(--ds-weight-bold)',
};
const height = {};
const width = {};
const size = {};
const minHeight = {};
const borderWidth = {};
const colors = {};

for (const [id, token] of orderedTokens) {
  const utilityValue = `var(${token.cssVar})`;
  if (id.startsWith('ref.space.')) {
    spacing[`ds-${id.slice('ref.space.'.length)}`] = utilityValue;
  } else if (id.startsWith('space.')) {
    spacing[`ds-${id.slice('space.'.length)}`] = utilityValue;
  } else if (id.startsWith('ref.radius.')) {
    borderRadius[`ds-${id.slice('ref.radius.'.length)}`] = utilityValue;
  } else if (id.startsWith('radius.')) {
    borderRadius[`ds-${id.slice('radius.'.length)}`] = utilityValue;
  } else if (id.startsWith('elevation.')) {
    boxShadow[`ds-${id.replaceAll('.', '-')}`] = utilityValue;
  } else if (
    id.startsWith('ref.controlHeight.') ||
    id.startsWith('controlHeight.')
  ) {
    const step = id.split('.').at(-1);
    const key = `ds-control-${step}`;
    height[key] = utilityValue;
    width[key] = utilityValue;
    size[key] = utilityValue;
    minHeight[key] = utilityValue;
  } else if (id.startsWith('ref.layoutRow.') || id.startsWith('layout.')) {
    const step = id.replace('ref.layoutRow.', '').replace('layout.', '');
    const key = `ds-layout-${step}`;
    height[key] = utilityValue;
    minHeight[key] = utilityValue;
  } else if (id.startsWith('ref.iconSize.') || id.startsWith('icon.')) {
    const step = id.split('.').at(-1);
    const key = `ds-icon-${step}`;
    height[key] = utilityValue;
    width[key] = utilityValue;
    size[key] = utilityValue;
  } else if (id.startsWith('ref.border.') || id.startsWith('border.')) {
    const step = id.split('.').at(-1);
    borderWidth[`ds-${step}`] = utilityValue;
  } else if (id.startsWith('role.text.') && id.endsWith('.size')) {
    const role = id.slice('role.text.'.length, -'.size'.length);
    const lineId = `role.text.${role}.line`;
    const lineToken = tokens.get(lineId);
    fontSize[`ds-text-${role}`] = [
      utilityValue,
      { lineHeight: `var(${lineToken.cssVar})` },
    ];
  } else if (id.startsWith('role.code.') && id.endsWith('.size')) {
    const role = id.slice('role.code.'.length, -'.size'.length);
    const lineToken = tokens.get(`role.code.${role}.line`);
    fontSize[`ds-code-${role}`] = [
      utilityValue,
      { lineHeight: `var(${lineToken.cssVar})` },
    ];
  }
}

fontSize['label-xs'] = fontSize['ds-text-meta'];
fontSize['body-xs'] = fontSize['ds-text-meta'];
fontSize['label-sm'] = fontSize['ds-text-base'];
fontSize['body-sm'] = fontSize['ds-text-base'];
fontSize['body-base'] = fontSize['ds-text-base'];
fontSize['body-md'] = fontSize['ds-text-body-large'];
fontSize['label-md'] = [
  'var(--ds-text-body-large-size)',
  { lineHeight: 'var(--ds-text-body-large-line)' },
];
fontSize['label-lg'] = fontSize['ds-text-title'];
fontSize['heading-xs'] = fontSize['ds-text-meta'];
fontSize['heading-base'] = fontSize['ds-text-page'];
fontSize['heading-2xl'] = fontSize['ds-text-display'];
fontSize['body-lg'] = fontSize['ds-text-section'];

const PUBLIC_GROUPS = ['accent', 'neutral', 'ink', 'hairline'];
const PUBLIC_EMPHASIS = ['subtle', 'muted', 'default', 'strong'];
const PUBLIC_STATES = ['default', 'hover', 'disabled', 'selected'];
const FEEDBACK_TONES = ['success', 'warning', 'error', 'information'];
for (const group of PUBLIC_GROUPS) {
  for (const emphasis of PUBLIC_EMPHASIS) {
    colors[`ds-${group}-on-${emphasis}`] = `var(--ds-${group}-on-${emphasis})`;
    for (const state of PUBLIC_STATES) {
      colors[`ds-${group}-${emphasis}-${state}`] =
        `var(--ds-${group}-${emphasis}-${state})`;
    }
  }
}
for (const tone of FEEDBACK_TONES) {
  for (const emphasis of PUBLIC_EMPHASIS) {
    colors[`ds-${tone}-on-${emphasis}`] = `var(--ds-${tone}-on-${emphasis})`;
  }
}
colors['ds-ring-focus'] = 'var(--ds-ring-focus)';
colors['ds-ink-inverse'] = 'var(--ds-ink-inverse)';
colors['ds-icon-inverse'] = 'var(--ds-icon-inverse)';
colors['ds-success-indicator-on-default'] =
  'var(--ds-success-indicator-on-default)';

const staticCssVariables = [
  ...orderedTokens.map(([, token]) => token.cssVar),
  ...PUBLIC_GROUPS.flatMap((group) => [
    ...PUBLIC_EMPHASIS.flatMap((emphasis) => [
      `--ds-${group}-on-${emphasis}`,
      ...PUBLIC_STATES.map((state) => `--ds-${group}-${emphasis}-${state}`),
    ]),
  ]),
  ...FEEDBACK_TONES.flatMap((tone) =>
    PUBLIC_EMPHASIS.map((emphasis) => `--ds-${tone}-on-${emphasis}`)
  ),
  '--ds-ring-focus',
  '--ds-theme-contrast',
  '--ds-ink-inverse',
  '--ds-icon-inverse',
  '--ds-success-indicator-on-default',
].sort();

const colorMatrixCssVariables = [];
for (const element of colorManifest.elements) {
  for (const tone of colorManifest.tones) {
    for (const emphasis of colorManifest.emphasis) {
      for (const state of colorManifest.states) {
        colorMatrixCssVariables.push(
          `--ds-${element}-${tone}-${emphasis}-${state}`
        );
      }
    }
  }
}
for (const color of colorManifest.category.colors) {
  for (const [style, state] of colorManifest.category.roles) {
    colorMatrixCssVariables.push(`--ds-category-${color}-${style}-${state}`);
  }
}

const declaredCssVariables = [
  ...staticCssVariables,
  ...colorMatrixCssVariables,
].sort();

const declaredUtilityTokens = new Set();
for (const element of colorManifest.elements) {
  for (const tone of colorManifest.tones) {
    for (const emphasis of colorManifest.emphasis) {
      for (const state of colorManifest.states) {
        declaredUtilityTokens.add(`ds-${element}-${tone}-${emphasis}-${state}`);
      }
    }
  }
}
for (const color of colorManifest.category.colors) {
  for (const [style, state] of colorManifest.category.roles) {
    declaredUtilityTokens.add(`ds-category-${color}-${style}-${state}`);
  }
}
for (const status of [
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
]) {
  declaredUtilityTokens.add(`ds-bg-${status}-subtle-default`);
}
for (const group of PUBLIC_GROUPS) {
  for (const emphasis of PUBLIC_EMPHASIS) {
    declaredUtilityTokens.add(`ds-${group}-on-${emphasis}`);
    for (const state of PUBLIC_STATES) {
      declaredUtilityTokens.add(`ds-${group}-${emphasis}-${state}`);
    }
  }
}
for (const tone of FEEDBACK_TONES) {
  for (const emphasis of PUBLIC_EMPHASIS) {
    declaredUtilityTokens.add(`ds-${tone}-on-${emphasis}`);
  }
}
declaredUtilityTokens.add('ds-ring-focus');
declaredUtilityTokens.add('ds-ink-inverse');
declaredUtilityTokens.add('ds-icon-inverse');
declaredUtilityTokens.add('ds-success-indicator-on-default');
for (const key of Object.keys(fontSize)) {
  declaredUtilityTokens.add(key.startsWith('ds-') ? key : `text-${key}`);
}
for (const themeMap of [
  colors,
  spacing,
  borderRadius,
  boxShadow,
  height,
  width,
  size,
  minHeight,
  borderWidth,
]) {
  for (const key of Object.keys(themeMap)) {
    declaredUtilityTokens.add(key);
  }
}

const tailwindModule = `/* GENERATED FILE. Do not edit. Source: src/style/tokens/*.json */
module.exports = ${JSON.stringify(
  {
    colors,
    spacing,
    borderRadius,
    boxShadow,
    fontSize,
    fontFamily,
    fontWeight,
    height,
    width,
    size,
    minHeight,
    borderWidth,
  },
  null,
  2
)};
`;

const typeLines = [
  '/* GENERATED FILE. Do not edit. Source: src/style/tokens/*.json */',
  '',
  'export const DS_TOKEN_IDS = [',
  ...orderedTokens.map(([id]) => `  '${id}',`),
  '] as const;',
  '',
  'export type DsTokenId = (typeof DS_TOKEN_IDS)[number];',
  '',
  'export const DS_CSS_VARIABLES = [',
  ...staticCssVariables.map((name) => `  '${name}',`),
  '] as const;',
  '',
  'export type DsCssVariable = (typeof DS_CSS_VARIABLES)[number];',
  '',
  'export const DS_TYPOGRAPHY_ROLES = {',
  ...Object.entries(typographyRoles).map(
    ([role, value]) =>
      `  '${role}': { sizePx: ${value.sizePx}, linePx: ${value.linePx} },`
  ),
  '} as const;',
  '',
];

const declared = {
  cssVariables: declaredCssVariables,
  utilityTokens: [...declaredUtilityTokens].sort(),
  tones: colorManifest.tones,
  toneAssignment: toneAssignment.families,
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, 'tokens.css'),
  `${cssLines.join('\n')}\n`
);
writeFileSync(
  path.join(outputDirectory, 'tokens.tailwind.cjs'),
  tailwindModule
);
writeFileSync(
  path.join(outputDirectory, 'tokens.types.ts'),
  typeLines.join('\n')
);
writeFileSync(
  path.join(outputDirectory, 'declared-tokens.json'),
  `${JSON.stringify(declared, null, 2)}\n`
);

const prettier = path.join(repositoryRoot, 'node_modules', '.bin', 'prettier');
execFileSync(
  prettier,
  [
    '--write',
    path.join(outputDirectory, 'tokens.css'),
    path.join(outputDirectory, 'tokens.types.ts'),
    path.join(outputDirectory, 'declared-tokens.json'),
  ],
  { cwd: repositoryRoot, stdio: 'inherit' }
);
execFileSync(
  process.execPath,
  [
    path.join(repositoryRoot, 'licenses', 'update_license.js'),
    path.join(outputDirectory, 'tokens.types.ts'),
  ],
  { cwd: repositoryRoot, stdio: 'inherit' }
);

process.stdout.write(
  `Generated ${tokens.size} tokens → ${path.relative(repositoryRoot, outputDirectory)}\n`
);
