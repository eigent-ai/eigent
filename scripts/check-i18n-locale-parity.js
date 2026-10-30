#!/usr/bin/env node
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

/* global console, process */

/**
 * Validates the complete frontend locale contract against `en-us`:
 * - exact locale and resource-file coverage;
 * - valid JSON without duplicate object keys;
 * - identical leaf keys, non-empty string values, placeholders, rich-text tags,
 *   and boundary whitespace;
 * - every literal `t()`, `i18n.t()`, and `<Trans i18nKey="...">` key in `src` exists.
 *
 * Run from repo root: `node scripts/check-i18n-locale-parity.js`
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const localesDir = path.join(projectRoot, 'src', 'i18n', 'locales');
const sourceDir = path.join(projectRoot, 'src');
const referenceLocale = 'en-us';

const expectedLocales = [
  'ar',
  'de',
  'en-us',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'ru',
  'zh-Hans',
  'zh-Hant',
].sort();

const expectedResourceFiles = [
  'agents.json',
  'chat.json',
  'common.json',
  'connectors.json',
  'dashboard.json',
  'folder.json',
  'layout.json',
  'markdown.json',
  'setting.json',
  'triggers.json',
  'update.json',
  'workforce.json',
].sort();

const pluralCategorySuffixes = ['zero', 'one', 'two', 'few', 'many', 'other'];

const localeLanguageTags = {
  ar: 'ar',
  de: 'de',
  'en-us': 'en-US',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  ru: 'ru',
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
};

let failed = false;

function report(message) {
  console.error(message);
  failed = true;
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function pluralCategoriesFor(locale) {
  return [
    ...new Intl.PluralRules(localeLanguageTags[locale]).resolvedOptions()
      .pluralCategories,
  ].sort();
}

function parsePluralLeaf(key) {
  const match = key.match(
    new RegExp(`^(.+)_(${pluralCategorySuffixes.join('|')})$`)
  );
  if (!match) return null;
  return { base: match[1], category: match[2] };
}

function collectPluralFamilies(leaves) {
  const families = new Map();
  for (const [key, value] of leaves) {
    const plural = parsePluralLeaf(key);
    if (!plural) continue;
    const family = families.get(plural.base) ?? new Map();
    family.set(plural.category, value);
    families.set(plural.base, family);
  }
  return families;
}

function pluralLeafKeys(families) {
  const keys = new Set();
  for (const [base, family] of families) {
    for (const category of family.keys()) {
      keys.add(`${base}_${category}`);
    }
  }
  return keys;
}

function flattenLeaves(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }

  out.set(prefix, value);
  return out;
}

function extractPlaceholders(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?}}/g)]
    .map((match) => match[1])
    .sort();
}

function extractRichTextTags(value) {
  return [...value.matchAll(/<\/?([A-Za-z0-9][\w-]*)\b[^>]*>/g)]
    .filter((match) => !match[0].endsWith('/>'))
    .map((match) => `${match[0].startsWith('</') ? '/' : ''}${match[1]}`)
    .sort();
}

function extractBoundaryWhitespace(value) {
  return {
    leading: value.match(/^\s*/)?.[0] ?? '',
    trailing: value.match(/\s*$/)?.[0] ?? '',
  };
}

function startsWithBoundaryPunctuation(value) {
  const first = value.trimStart().match(/^./u)?.[0] ?? '';
  return /^[\p{P}\p{S}]$/u.test(first);
}

function propertyName(property, sourceFile) {
  if (
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name) ||
    ts.isIdentifier(property.name)
  ) {
    return property.name.text;
  }
  return property.name.getText(sourceFile);
}

function findDuplicateKeys(
  node,
  sourceFile,
  locale,
  relativeFile,
  prefix = ''
) {
  if (ts.isObjectLiteralExpression(node)) {
    const seen = new Map();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;

      const name = propertyName(property, sourceFile);
      const dotted = prefix ? `${prefix}.${name}` : name;
      const first = seen.get(name);
      if (first) {
        const firstLine =
          sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile))
            .line + 1;
        const duplicateLine =
          sourceFile.getLineAndCharacterOfPosition(
            property.getStart(sourceFile)
          ).line + 1;
        report(
          `Duplicate key [${locale}] ${relativeFile}: ${dotted} (lines ${firstLine}, ${duplicateLine})`
        );
      } else {
        seen.set(name, property);
      }

      findDuplicateKeys(
        property.initializer,
        sourceFile,
        locale,
        relativeFile,
        dotted
      );
    }
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((element, index) =>
      findDuplicateKeys(
        element,
        sourceFile,
        locale,
        relativeFile,
        `${prefix}[${index}]`
      )
    );
  }
}

function readResource(locale, relativeFile) {
  const filePath = path.join(localesDir, locale, relativeFile);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    report(`Could not read [${locale}] ${relativeFile}: ${error.message}`);
    return null;
  }

  const sourceFile = ts.parseJsonText(filePath, text);
  for (const diagnostic of sourceFile.parseDiagnostics) {
    const location =
      diagnostic.start !== undefined
        ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
    const suffix = location
      ? `:${location.line + 1}:${location.character + 1}`
      : '';
    report(
      `Invalid JSON [${locale}] ${relativeFile}${suffix}: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n'
      )}`
    );
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement)) {
      findDuplicateKeys(statement.expression, sourceFile, locale, relativeFile);
    }
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (sourceFile.parseDiagnostics.length === 0) {
      report(`Invalid JSON [${locale}] ${relativeFile}: ${error.message}`);
    }
    return null;
  }
}

function validateLeafValues(locale, relativeFile, leaves) {
  for (const [key, value] of leaves) {
    if (typeof value !== 'string') {
      report(
        `Non-string value [${locale}] ${relativeFile}: ${key} (${value === null ? 'null' : typeof value})`
      );
    } else if (!value.trim()) {
      report(`Empty value [${locale}] ${relativeFile}: ${key}`);
    }
  }
}

function compareValueContract(
  locale,
  relativeFile,
  key,
  referenceValue,
  targetValue
) {
  if (typeof referenceValue !== typeof targetValue) {
    report(
      `Value type mismatch [${locale}] ${relativeFile}: ${key} (${typeof referenceValue} != ${typeof targetValue})`
    );
    return;
  }
  if (typeof referenceValue !== 'string' || typeof targetValue !== 'string') {
    return;
  }

  const referencePlaceholders = extractPlaceholders(referenceValue);
  const targetPlaceholders = extractPlaceholders(targetValue);
  if (!arraysEqual(referencePlaceholders, targetPlaceholders)) {
    report(
      `Placeholder mismatch [${locale}] ${relativeFile}: ${key} (en-us=[${referencePlaceholders.join(
        ', '
      )}], locale=[${targetPlaceholders.join(', ')}])`
    );
  }

  const referenceTags = extractRichTextTags(referenceValue);
  const targetTags = extractRichTextTags(targetValue);
  if (!arraysEqual(referenceTags, targetTags)) {
    report(
      `Rich-text tag mismatch [${locale}] ${relativeFile}: ${key} (en-us=[${referenceTags.join(
        ', '
      )}], locale=[${targetTags.join(', ')}])`
    );
  }

  const referenceWhitespace = extractBoundaryWhitespace(referenceValue);
  const targetWhitespace = extractBoundaryWhitespace(targetValue);
  const leadingWhitespaceMatches =
    referenceWhitespace.leading === targetWhitespace.leading ||
    (referenceWhitespace.leading.length > 0 &&
      targetWhitespace.leading.length === 0 &&
      startsWithBoundaryPunctuation(targetValue));
  if (
    !leadingWhitespaceMatches ||
    referenceWhitespace.trailing !== targetWhitespace.trailing
  ) {
    report(
      `Boundary whitespace mismatch [${locale}] ${relativeFile}: ${key} (en-us=${JSON.stringify(
        referenceWhitespace
      )}, locale=${JSON.stringify(targetWhitespace)})`
    );
  }
}

function validatePluralFamilyCoverage(locale, relativeFile, families) {
  const expectedCategories = pluralCategoriesFor(locale);
  for (const [base, family] of families) {
    const actualCategories = [...family.keys()].sort();
    for (const category of difference(expectedCategories, actualCategories)) {
      report(
        `Missing plural category [${locale}] ${relativeFile}: ${base}_${category}`
      );
    }
    for (const category of difference(actualCategories, expectedCategories)) {
      report(
        `Unexpected plural category [${locale}] ${relativeFile}: ${base}_${category}`
      );
    }
  }
}

function compareResources(locale, relativeFile, referenceLeaves, targetLeaves) {
  const referenceFamilies = collectPluralFamilies(referenceLeaves);
  const targetFamilies = collectPluralFamilies(targetLeaves);
  const referencePluralLeaves = pluralLeafKeys(referenceFamilies);
  const targetPluralLeaves = pluralLeafKeys(targetFamilies);

  for (const [key, referenceValue] of referenceLeaves) {
    if (referencePluralLeaves.has(key)) continue;
    if (!targetLeaves.has(key)) {
      report(`Missing key [${locale}] ${relativeFile}: ${key}`);
      continue;
    }

    compareValueContract(
      locale,
      relativeFile,
      key,
      referenceValue,
      targetLeaves.get(key)
    );
  }

  for (const key of targetLeaves.keys()) {
    if (targetPluralLeaves.has(key)) {
      const plural = parsePluralLeaf(key);
      if (plural && !referenceFamilies.has(plural.base)) {
        report(`Extra key [${locale}] ${relativeFile}: ${key}`);
      }
    } else if (!referenceLeaves.has(key)) {
      report(`Extra key [${locale}] ${relativeFile}: ${key}`);
    }
  }

  const requiredTargetCategories = pluralCategoriesFor(locale);
  for (const [base, referenceFamily] of referenceFamilies) {
    const targetFamily = targetFamilies.get(base) ?? new Map();
    for (const category of requiredTargetCategories) {
      if (!targetFamily.has(category)) {
        report(
          `Missing plural category [${locale}] ${relativeFile}: ${base}_${category}`
        );
        continue;
      }

      const referenceValue =
        referenceFamily.get(category) ?? referenceFamily.get('other');
      if (referenceValue === undefined) continue;
      compareValueContract(
        locale,
        relativeFile,
        `${base}_${category}`,
        referenceValue,
        targetFamily.get(category)
      );
    }

    for (const category of targetFamily.keys()) {
      if (!requiredTargetCategories.includes(category)) {
        report(
          `Unexpected plural category [${locale}] ${relativeFile}: ${base}_${category}`
        );
      }
    }
  }
}

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(?:[jt]sx?)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function scriptKindFor(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isTranslationCall(expression) {
  if (ts.isIdentifier(expression)) return expression.text === 't';
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === 'i18n' ||
      expression.expression.text === 'i18next') &&
    expression.name.text === 't'
  );
}

function recordSourceKey(keys, key, sourceFile, node, filePath) {
  const line =
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;
  const relativePath = path.relative(projectRoot, filePath);
  const references = keys.get(key) ?? new Set();
  references.add(`${relativePath}:${line}`);
  keys.set(key, references);
}

function collectLiteralSourceKeys() {
  const keys = new Map();

  for (const filePath of collectSourceFiles(sourceDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath)
    );

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        isTranslationCall(node.expression) &&
        node.arguments[0] &&
        isLiteral(node.arguments[0])
      ) {
        recordSourceKey(
          keys,
          node.arguments[0].text,
          sourceFile,
          node,
          filePath
        );
      }

      if (ts.isJsxAttribute(node) && node.name.text === 'i18nKey') {
        const tag = node.parent?.parent?.tagName;
        const tagName = tag?.getText(sourceFile);
        if (
          tagName === 'Trans' &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        ) {
          recordSourceKey(
            keys,
            node.initializer.text,
            sourceFile,
            node,
            filePath
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return keys;
}

function validateSourceKeys(referenceKeys) {
  const missing = [...collectLiteralSourceKeys()]
    .filter(([key]) => !referenceKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  if (missing.length === 0) return;

  report(`\nMissing literal source translation keys (${missing.length}):`);
  const grouped = new Map();
  for (const [key, references] of missing) {
    const prefix = key.split('.')[0];
    const entries = grouped.get(prefix) ?? [];
    entries.push([key, references]);
    grouped.set(prefix, entries);
  }

  for (const [prefix, entries] of [...grouped].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    console.error(`  [${prefix}] (${entries.length})`);
    for (const [key, references] of entries) {
      console.error(`    ${key} <- ${[...references].sort().join(', ')}`);
    }
  }
}

function main() {
  const actualLocales = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const locale of difference(expectedLocales, actualLocales)) {
    report(`Missing locale directory: ${locale}`);
  }
  for (const locale of difference(actualLocales, expectedLocales)) {
    report(`Unexpected locale directory: ${locale}`);
  }

  const availableLocales = expectedLocales.filter((locale) =>
    actualLocales.includes(locale)
  );
  const resourcesByLocale = new Map();

  for (const locale of availableLocales) {
    const localePath = path.join(localesDir, locale);
    const actualFiles = fs
      .readdirSync(localePath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();

    for (const file of difference(expectedResourceFiles, actualFiles)) {
      report(`Missing resource file [${locale}]: ${file}`);
    }
    for (const file of difference(actualFiles, expectedResourceFiles)) {
      report(`Unexpected resource file [${locale}]: ${file}`);
    }

    const localeResources = new Map();
    for (const relativeFile of expectedResourceFiles) {
      if (!actualFiles.includes(relativeFile)) continue;
      const resource = readResource(locale, relativeFile);
      if (resource === null) continue;
      const leaves = flattenLeaves(resource);
      validateLeafValues(locale, relativeFile, leaves);
      localeResources.set(relativeFile, leaves);
    }
    resourcesByLocale.set(locale, localeResources);
  }

  const referenceResources = resourcesByLocale.get(referenceLocale);
  if (!referenceResources) {
    report(`Reference locale could not be loaded: ${referenceLocale}`);
  } else {
    for (const [relativeFile, leaves] of referenceResources) {
      validatePluralFamilyCoverage(
        referenceLocale,
        relativeFile,
        collectPluralFamilies(leaves)
      );
    }

    for (const locale of availableLocales) {
      if (locale === referenceLocale) continue;
      const localeResources = resourcesByLocale.get(locale);
      for (const relativeFile of expectedResourceFiles) {
        const referenceLeaves = referenceResources.get(relativeFile);
        const targetLeaves = localeResources?.get(relativeFile);
        if (!referenceLeaves || !targetLeaves) continue;
        compareResources(locale, relativeFile, referenceLeaves, targetLeaves);
      }
    }

    const referenceKeys = new Set();
    for (const [relativeFile, leaves] of referenceResources) {
      const prefix = path.basename(relativeFile, '.json');
      for (const key of leaves.keys()) {
        referenceKeys.add(`${prefix}.${key}`);
      }
      for (const [base, family] of collectPluralFamilies(leaves)) {
        const expectedCategories = pluralCategoriesFor(referenceLocale);
        if (expectedCategories.every((category) => family.has(category))) {
          referenceKeys.add(`${prefix}.${base}`);
        }
      }
    }
    validateSourceKeys(referenceKeys);
  }

  if (failed) {
    console.error('\ncheck-i18n-locale-parity: FAILED');
    process.exit(1);
  }
  console.log('check-i18n-locale-parity: OK');
}

main();
