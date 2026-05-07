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
 * Shared helpers for i18n locale JSON under `src/i18n/locales/`.
 * Mirrors merge order in each locale's `index.ts` (e.g. en-us/index.ts).
 */

import fs from 'fs';
import path from 'path';

/** Same order and set as `src/i18n/locales/en-us/index.ts` default export keys. */
export const EN_US_NAMESPACE_ORDER = [
  'agents',
  'layout',
  'dashboard',
  'folder',
  'workforce',
  'chat',
  'setting',
  'update',
  'triggers',
];

export const REFERENCE_LOCALE_DIR = 'en-us';

export function getLocalesDir(projectRoot) {
  return path.join(projectRoot, 'src', 'i18n', 'locales');
}

export function collectJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...collectJsonFiles(full));
    } else if (e.isFile() && e.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

export function flattenLeaves(obj, prefix = '') {
  /** @type {string[]} */
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenLeaves(v, p));
    } else {
      keys.push(p);
    }
  }
  return keys;
}

/**
 * @param {Record<string, unknown>} merged - e.g. { layout: {...}, chat: {...} }
 * @returns {Map<string, unknown>} dotted keys like `layout.foo` -> leaf value
 */
export function flattenMergedTranslation(merged) {
  /** @type {Map<string, unknown>} */
  const map = new Map();
  for (const ns of Object.keys(merged)) {
    const block = merged[ns];
    if (block === null || typeof block !== 'object' || Array.isArray(block))
      continue;
    const inner = flattenLeaves(/** @type {Record<string, unknown>} */ (block));
    for (const k of inner) {
      map.set(
        `${ns}.${k}`,
        getLeaf(/** @type {Record<string, unknown>} */ (block), k.split('.'))
      );
    }
  }
  return map;
}

function getLeaf(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[p];
  }
  return cur;
}

/**
 * Load namespace JSON files for a locale directory (not using index.ts).
 * @param {string} localePath absolute path to `locales/<locale>/`
 */
export function loadLocaleNamespaces(localePath) {
  /** @type {Record<string, Record<string, unknown>>} */
  const merged = {};
  for (const ns of EN_US_NAMESPACE_ORDER) {
    const fp = path.join(localePath, `${ns}.json`);
    if (!fs.existsSync(fp)) {
      merged[ns] = {};
      continue;
    }
    const text = fs.readFileSync(fp, 'utf8');
    merged[ns] = JSON.parse(text);
  }
  return merged;
}

/**
 * i18next-style placeholders: `{{name}}`, `{{ count }}`.
 * @param {string} s
 * @returns {Set<string>} normalized placeholder names (trimmed)
 */
export function extractI18nPlaceholders(s) {
  const set = new Set();
  if (typeof s !== 'string') return set;
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(s))) {
    set.add(m[1].trim());
  }
  return set;
}

function placeholderSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/**
 * Longer English-looking strings that are still byte-identical to en-us in another locale are likely not translated yet.
 * @param {string} enVal
 */
export function isLikelyUntranslatedEnglishCopy(enVal) {
  if (enVal.length < 12) return false;
  if (!/[a-zA-Z]{4,}/.test(enVal)) return false;
  return true;
}

/**
 * Per-key placeholder parity with en-us; optional detection of copy-paste English in non-reference locales.
 * @param {string} projectRoot
 * @returns {{ placeholderMismatches: string[], untranslatedCopies: string[] }}
 */
export function compareNonEnLocalesToEnglish(projectRoot) {
  const localesDir = getLocalesDir(projectRoot);
  const { merged: enMerged, errors } = loadEnUsFlat(projectRoot);
  /** @type {string[]} */
  const placeholderMismatches = [];
  /** @type {string[]} */
  const untranslatedCopies = [];

  if (errors.length) {
    return { placeholderMismatches: errors, untranslatedCopies: [] };
  }

  const flatEn = flattenMergedTranslation(enMerged);

  for (const loc of listLocaleFolders(projectRoot)) {
    const merged = loadLocaleNamespaces(path.join(localesDir, loc));
    const flatLoc = flattenMergedTranslation(merged);
    for (const [key, enVal] of flatEn) {
      if (typeof enVal !== 'string') continue;
      const locVal = flatLoc.get(key);
      if (typeof locVal !== 'string') continue;

      const enPh = extractI18nPlaceholders(enVal);
      const locPh = extractI18nPlaceholders(locVal);
      if (!placeholderSetsEqual(enPh, locPh)) {
        const enStr = [...enPh].sort().join(', ') || '(none)';
        const loStr = [...locPh].sort().join(', ') || '(none)';
        placeholderMismatches.push(
          `[${loc}] ${key}: placeholders [${loStr}] do not match en-us [${enStr}]`
        );
      }

      if (locVal === enVal && isLikelyUntranslatedEnglishCopy(enVal)) {
        untranslatedCopies.push(
          `[${loc}] ${key}: string still identical to English (untranslated)`
        );
      }
    }
  }

  return { placeholderMismatches, untranslatedCopies };
}

/**
 * Detect duplicate keys inside a single JSON object (same nesting level).
 * `JSON.parse` would silently keep the last value — this surfaces mistakes.
 * @returns {{ line: number, key: string }[]} diagnostics (line is 1-based, best-effort)
 */
export function findDuplicateKeysInJson(text) {
  /** @type {{ line: number, key: string }[]} */
  const dups = [];
  let i = 0;
  const lineOf = (idx) => {
    let line = 1;
    for (let j = 0; j < idx && j < text.length; j++) {
      if (text[j] === '\n') line++;
    }
    return line;
  };
  const skipWs = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  /** @returns {string|null} decoded string, or null */
  const parseJsonStringToken = () => {
    if (text[i] !== '"') return null;
    const start = i;
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        try {
          return JSON.parse(text.slice(start, i));
        } catch {
          return null;
        }
      }
      i++;
    }
    return null;
  };
  const walkValue = () => {
    skipWs();
    if (i >= text.length) return;
    const c = text[i];
    if (c === '{') {
      walkObject();
      return;
    }
    if (c === '[') {
      walkArray();
      return;
    }
    if (c === '"') {
      parseJsonStringToken();
      return;
    }
    if (
      c === 't' ||
      c === 'f' ||
      c === 'n' ||
      c === '-' ||
      (c >= '0' && c <= '9')
    ) {
      while (i < text.length && !',]}'.includes(text[i])) i++;
      return;
    }
    i++;
  };
  const walkArray = () => {
    if (text[i] !== '[') return;
    i++;
    while (true) {
      skipWs();
      if (i < text.length && text[i] === ']') {
        i++;
        return;
      }
      walkValue();
      skipWs();
      if (i < text.length && text[i] === ',') {
        i++;
        continue;
      }
      if (i < text.length && text[i] === ']') {
        i++;
        return;
      }
      break;
    }
  };
  const walkObject = () => {
    if (text[i] !== '{') return;
    i++;
    /** @type {Map<string, number>} */
    const seen = new Map();
    while (true) {
      skipWs();
      if (i < text.length && text[i] === '}') {
        i++;
        return;
      }
      if (text[i] !== '"') return;
      const keyStart = i;
      const key = parseJsonStringToken();
      if (key === null) return;
      const line = lineOf(keyStart);
      if (seen.has(key)) {
        dups.push({ line, key });
      } else {
        seen.set(key, line);
      }
      skipWs();
      if (i >= text.length || text[i] !== ':') return;
      i++;
      walkValue();
      skipWs();
      if (i < text.length && text[i] === ',') {
        i++;
        continue;
      }
      if (i < text.length && text[i] === '}') {
        i++;
        return;
      }
      return;
    }
  };
  skipWs();
  if (i < text.length && text[i] === '{') {
    walkObject();
  }
  return dups;
}

/**
 * @param {string} projectRoot
 * @returns {{ errors: string[], merged: Record<string, Record<string, unknown>> }}
 */
export function loadEnUsFlat(projectRoot) {
  const localesDir = getLocalesDir(projectRoot);
  const enPath = path.join(localesDir, REFERENCE_LOCALE_DIR);
  const errors = [];
  if (!fs.existsSync(enPath)) {
    errors.push(`Reference locale not found: ${enPath}`);
    return { errors, merged: {} };
  }
  const merged = loadLocaleNamespaces(enPath);
  return { errors: errors.length ? errors : [], merged };
}

/**
 * @returns {{ ok: boolean, messages: string[] }}
 */
export function checkLocaleParity(projectRoot) {
  const localesDir = getLocalesDir(projectRoot);
  const refPath = path.join(localesDir, REFERENCE_LOCALE_DIR);
  /** @type {string[]} */
  const messages = [];
  if (!fs.existsSync(refPath)) {
    return { ok: false, messages: [`Reference locale not found: ${refPath}`] };
  }

  const refFiles = collectJsonFiles(refPath);
  const refRelative = refFiles.map((f) => path.relative(refPath, f));

  const localeDirs = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== REFERENCE_LOCALE_DIR);

  let ok = true;
  for (const locale of localeDirs) {
    const locPath = path.join(localesDir, locale);
    for (const rel of refRelative) {
      const refFile = path.join(refPath, rel);
      const targetFile = path.join(locPath, rel);
      if (!fs.existsSync(targetFile)) {
        messages.push(`Missing file [${locale}]: ${rel}`);
        ok = false;
        continue;
      }
      let refJson;
      let tgtJson;
      try {
        refJson = JSON.parse(fs.readFileSync(refFile, 'utf8'));
        tgtJson = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      } catch (e) {
        messages.push(
          `Invalid JSON (${locale}/${rel}): ${/** @type {Error} */ (e).message}`
        );
        ok = false;
        continue;
      }
      const refKeys = new Set(flattenLeaves(refJson));
      const tgtKeys = new Set(flattenLeaves(tgtJson));
      for (const k of refKeys) {
        if (!tgtKeys.has(k)) {
          messages.push(`Missing key [${locale}] ${rel}: ${k}`);
          ok = false;
        }
      }
      for (const k of tgtKeys) {
        if (!refKeys.has(k)) {
          messages.push(`Extra key [${locale}] ${rel}: ${k}`);
          ok = false;
        }
      }
    }
  }
  return { ok, messages };
}

/**
 * Remove dotted keys `ns.leaf` from namespace JSON objects; writes pretty JSON.
 * @param {string} localePath
 * @param {Set<string>} fullKeysToRemove dotted `namespace.rest`
 * @param {Set<string>|null} namespacesFilter
 */
export function pruneKeysInLocale(
  localePath,
  fullKeysToRemove,
  namespacesFilter = null,
  dryRun = true
) {
  /** @type {string[]} */
  const changed = [];
  for (const ns of EN_US_NAMESPACE_ORDER) {
    if (namespacesFilter && !namespacesFilter.has(ns)) continue;
    const toStrip = [...fullKeysToRemove].filter((fk) =>
      fk.startsWith(`${ns}.`)
    );
    if (toStrip.length === 0) continue;
    const fp = path.join(localePath, `${ns}.json`);
    if (!fs.existsSync(fp)) continue;
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const fk of toStrip) {
      const rest = fk.slice(ns.length + 1);
      if (!rest) continue;
      deleteNestedKey(obj, rest.split('.'));
    }
    if (!dryRun) {
      fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    }
    changed.push(ns);
  }
  return changed;
}

function deleteNestedKey(obj, parts) {
  if (parts.length === 0) return;
  const [head, ...tail] = parts;
  if (tail.length === 0) {
    delete obj[head];
    return;
  }
  const next = obj[head];
  if (next && typeof next === 'object' && !Array.isArray(next)) {
    deleteNestedKey(/** @type {Record<string, unknown>} */ (next), tail);
  }
}

export function listLocaleFolders(projectRoot) {
  const localesDir = getLocalesDir(projectRoot);
  return fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== REFERENCE_LOCALE_DIR);
}
