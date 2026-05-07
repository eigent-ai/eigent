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
 * Validates i18n: code keys vs English JSON, duplicate JSON keys / values, cross-locale key parity,
 * placeholder parity vs en-us, stale-English detection, unused keys, optional JSX raw-text scan.
 * Run from repo root: `node scripts/check-i18n-schema.js` or `npm run check:i18n`.
 *
 * Flags:
 *   --strict-dynamic     treat non-literal t() / i18n.t() first args as errors
 *   --fail-on-unused     unused English keys fail the run (default: warn)
 *   --fail-on-untranslated  non-en strings identical to English fail (default: warn for long English-like copy)
 *   --check-jsx-text     flag JSX text nodes that look like user-visible copy
 *   --apply-prune --yes  remove unused keys from all locale JSON (destructive)
 *   --fail-on-untranslated  non-English locale strings identical to English fail the run (default: warn)
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';
import {
  REFERENCE_LOCALE_DIR,
  checkLocaleParity,
  collectJsonFiles,
  compareNonEnLocalesToEnglish,
  findDuplicateKeysInJson,
  flattenMergedTranslation,
  getLocalesDir,
  listLocaleFolders,
  loadEnUsFlat,
  pruneKeysInLocale,
} from './lib/i18n-locales.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/** @typedef {{ file: string, line: number, col: number, detail: string }} ScanHit */

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectTsSources(dir) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (
          e.name === 'node_modules' ||
          e.name === 'dist' ||
          e.name === 'dist-electron'
        )
          continue;
        walk(full);
      } else if (
        (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) &&
        !e.name.endsWith('.d.ts')
      ) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * @param {ts.SourceFile} sf
 * @param {number} pos
 */
function lineColInFile(sf, pos) {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function getJsxAttrName(attr) {
  if (ts.isIdentifier(attr.name)) return attr.name.text;
  if (ts.isJsxNamespacedName(attr.name)) {
    return `${attr.name.namespace.text}:${attr.name.name.text}`;
  }
  return '';
}

function jsxAttrStringValue(init) {
  if (!init) return null;
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
    return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const ex = init.expression;
    if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex))
      return ex.text;
  }
  return null;
}

function hasI18nIgnoreComment(sf, pos) {
  const fullStart = pos;
  const text = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, fullStart);
  if (!ranges) return false;
  for (const r of ranges) {
    const c = text.slice(r.pos, r.end);
    if (c.includes('i18n-ignore')) return true;
  }
  return false;
}

/**
 * @param {ts.Node} call
 * @returns {boolean}
 */
function isTranslationCall(call) {
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  if (ts.isIdentifier(callee) && callee.text === 't') return true;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    return callee.name.text === 't';
  }
  return false;
}

function firstArgStringOrDynamic(arg) {
  if (!arg) return { kind: 'none' };
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return { kind: 'static', value: arg.text };
  }
  if (ts.isTemplateLiteral(arg)) {
    if (arg.templateSpans.length === 0) {
      return { kind: 'static', value: arg.head.text }; // shouldn't happen
    }
    return { kind: 'dynamic' };
  }
  return { kind: 'dynamic' };
}

function objectHasDefaultValue(arg) {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'defaultValue') return true;
  }
  return false;
}

/**
 * @param {string} filePath
 * @param {ts.SourceFile} sf
 * @param {Set<string>} usedKeys
 * @param {ScanHit[]} dynamicHits
 * @param {ScanHit[]} defaultValueWarns
 * @param {ScanHit[]} jsxTextHits
 * @param {boolean} checkJsxText
 */
function scanSourceFile(
  filePath,
  sf,
  usedKeys,
  dynamicHits,
  defaultValueWarns,
  jsxTextHits,
  checkJsxText
) {
  function visit(node) {
    if (checkJsxText) {
      if (
        ts.isJsxText(node) &&
        node.getFullText().trim().length > 0 &&
        looksLikeUserVisibleText(node.getText())
      ) {
        const lc = lineColInFile(sf, node.getStart());
        let ignored = hasI18nIgnoreComment(sf, node.getFullStart());
        if (!ignored) {
          let parent = node.parent;
          while (
            parent &&
            !ts.isJsxElement(parent) &&
            !ts.isJsxFragment(parent)
          ) {
            parent = parent.parent;
          }
          if (parent && ts.isJsxElement(parent)) {
            ignored = hasI18nIgnoreComment(
              sf,
              parent.openingElement.getFullStart()
            );
          }
        }
        if (!ignored) {
          jsxTextHits.push({
            file: filePath,
            line: lc.line,
            col: lc.col,
            detail: `JSX text (wrap with t() or Trans): ${JSON.stringify(node.getText().trim().slice(0, 80))}`,
          });
        }
      }
    }

    if (isTranslationCall(node)) {
      const arg0 = node.arguments[0];
      const res = firstArgStringOrDynamic(arg0);
      const lc = lineColInFile(sf, node.getStart());
      if (res.kind === 'static' && res.value) {
        usedKeys.add(res.value);
        const arg1 = node.arguments[1];
        if (objectHasDefaultValue(arg1)) {
          defaultValueWarns.push({
            file: filePath,
            line: lc.line,
            col: lc.col,
            detail: `t('${keySnippet(res.value)}') uses defaultValue — prefer defining the key in en-us JSON`,
          });
        }
      } else if (res.kind === 'dynamic' || res.kind === 'none') {
        dynamicHits.push({
          file: filePath,
          line: lc.line,
          col: lc.col,
          detail: 'non-literal translation key (cannot verify against schema)',
        });
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && tag.text === 'Trans') {
        const attrs = node.attributes;
        for (const prop of attrs.properties) {
          if (!ts.isJsxAttribute(prop)) continue;
          if (getJsxAttrName(prop) !== 'i18nKey') continue;
          const v = jsxAttrStringValue(prop.initializer);
          const lc = lineColInFile(sf, prop.getStart());
          if (v) usedKeys.add(v);
          else {
            dynamicHits.push({
              file: filePath,
              line: lc.line,
              col: lc.col,
              detail: 'Trans i18nKey is not a string literal',
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function keySnippet(k) {
  return k.length > 60 ? `${k.slice(0, 57)}…` : k;
}

function looksLikeUserVisibleText(s) {
  const t = s.trim();
  if (t.length < 3) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^\d+([.,:]\d+)?$/.test(t)) return false;
  if (/^[\d\s./|:\\\-–—:]+$/.test(t)) return false;
  return /[a-zA-Z]{3,}/.test(t);
}

function parseArgs(argv) {
  return {
    strictDynamic: argv.includes('--strict-dynamic'),
    failOnUnused: argv.includes('--fail-on-unused'),
    failOnUntranslated: argv.includes('--fail-on-untranslated'),
    checkJsxText: argv.includes('--check-jsx-text'),
    applyPrune: argv.includes('--apply-prune'),
    yes: argv.includes('--yes'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp() {
  console.log(`check-i18n-schema.js — verify i18n keys, locale parity, JSON hygiene

Usage:
  node scripts/check-i18n-schema.js [options]

Options:
  --strict-dynamic        error on non-literal t() / i18n.t() keys
  --fail-on-unused        fail when English has keys not referenced in src/
  --fail-on-untranslated  fail when a non-en value is still identical to English (long strings)
  --check-jsx-text        warn on raw JSX text that looks user-visible (use // i18n-ignore to suppress)
  --apply-prune      with --yes, delete unused keys from all locale *.json files
  --yes              confirm destructive prune
  -h, --help
`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let failed = false;
  let warned = false;

  const { merged, errors } = loadEnUsFlat(projectRoot);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }

  const localesDir = getLocalesDir(projectRoot);
  const enPath = path.join(localesDir, REFERENCE_LOCALE_DIR);

  for (const rel of collectJsonFiles(enPath)) {
    const raw = fs.readFileSync(rel, 'utf8');
    const dupList = findDuplicateKeysInJson(raw);
    if (dupList.length) {
      failed = true;
      const fileRel = path.relative(enPath, rel);
      for (const d of dupList) {
        console.error(
          `Duplicate key in en-us/${fileRel} line ${d.line}: "${d.key}"`
        );
      }
    }
  }

  const flatEn = flattenMergedTranslation(merged);
  const valueToKeys = new Map();
  for (const [k, v] of flatEn) {
    if (typeof v !== 'string') continue;
    const list = valueToKeys.get(v) ?? [];
    list.push(k);
    valueToKeys.set(v, list);
  }
  for (const [, keys] of valueToKeys) {
    if (keys.length > 1) {
      console.warn(`[duplicate English value] ${keys.join(' | ')}`);
    }
  }

  const srcRoot = path.join(projectRoot, 'src');
  const sources = collectTsSources(srcRoot);
  /** @type {Set<string>} */
  const usedKeys = new Set();
  /** @type {ScanHit[]} */
  const dynamicHits = [];
  /** @type {ScanHit[]} */
  const defaultValueWarns = [];
  /** @type {ScanHit[]} */
  const jsxTextHits = [];

  for (const filePath of sources) {
    const text = fs.readFileSync(filePath, 'utf8');
    const sf = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    scanSourceFile(
      path.relative(projectRoot, filePath),
      sf,
      usedKeys,
      dynamicHits,
      defaultValueWarns,
      jsxTextHits,
      opts.checkJsxText
    );
  }

  for (const h of defaultValueWarns) {
    console.warn(`[defaultValue] ${h.file}:${h.line}:${h.col} ${h.detail}`);
    warned = true;
  }

  for (const h of dynamicHits) {
    const msg = `[dynamic key] ${h.file}:${h.line}:${h.col} ${h.detail}`;
    if (opts.strictDynamic) {
      console.error(msg);
      failed = true;
    } else {
      console.warn(msg);
      warned = true;
    }
  }

  for (const h of jsxTextHits) {
    console.warn(`[jsx text] ${h.file}:${h.line}:${h.col} ${h.detail}`);
    warned = true;
  }

  for (const key of usedKeys) {
    if (!flatEn.has(key)) {
      console.error(`Missing key in en-us JSON (referenced in code): ${key}`);
      failed = true;
    }
  }

  /** @type {Set<string>} */
  const unused = new Set();
  for (const key of flatEn.keys()) {
    if (!usedKeys.has(key)) unused.add(key);
  }
  for (const u of [...unused].sort()) {
    const line = opts.failOnUnused ? console.error : console.warn;
    line(`[unused key] ${u}`);
    if (opts.failOnUnused) failed = true;
    else warned = true;
  }

  const parity = checkLocaleParity(projectRoot);
  if (!parity.ok) {
    failed = true;
    for (const m of parity.messages) console.error(m);
  }

  const { placeholderMismatches, untranslatedCopies } =
    compareNonEnLocalesToEnglish(projectRoot);
  for (const line of placeholderMismatches) {
    console.error(`[schema placeholder mismatch] ${line}`);
    failed = true;
  }
  for (const line of untranslatedCopies) {
    if (opts.failOnUntranslated) {
      console.error(`[untranslated] ${line}`);
      failed = true;
    } else {
      console.warn(`[untranslated] ${line}`);
      warned = true;
    }
  }

  if (opts.applyPrune) {
    if (!opts.yes) {
      console.error(
        '--apply-prune requires --yes (destructive: removes keys from all locales)'
      );
      failed = true;
    } else if (!failed && unused.size > 0) {
      const folders = [REFERENCE_LOCALE_DIR, ...listLocaleFolders(projectRoot)];
      for (const loc of folders) {
        const lp = path.join(localesDir, loc);
        pruneKeysInLocale(lp, unused, null, false);
        console.log(`Pruned unused keys in ${loc}`);
      }
    } else if (unused.size === 0) {
      console.log('No unused keys to prune.');
    }
  }

  if (failed) {
    console.error('\ncheck-i18n-schema: FAILED');
    process.exit(1);
  }
  if (warned) {
    console.log('check-i18n-schema: OK (with warnings)');
    process.exit(0);
  }
  console.log('check-i18n-schema: OK');
}

main();
