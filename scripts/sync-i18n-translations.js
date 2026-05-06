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

/* global console, process, fetch, setTimeout */

/**
 * Sync non-English locale JSON to match English (en-us) keys.
 *
 * Loads **`.env`** then **`.env.local`** from the repo root when present (only fills vars that are
 * not already set in the environment, so shell `export …` still wins). **Never commit** secrets;
 * `.env.local` is gitignored.
 *
 * **AiHubMix** (OpenAI-compatible): set `AIHUBMIX_API_KEY` + `AIHUBMIX_BASE_URL` in `.env.local` or export them.
 *
 * ```bash
 * # .env.local (example)
 * AIHUBMIX_API_KEY=...
 * AIHUBMIX_BASE_URL=https://aihubmix.com/v1
 * OPENAI_MODEL=gpt-4o-mini
 *
 * npm run i18n:sync -- --write --locales=ja
 * ```
 *
 * Usage:
 *   node scripts/sync-i18n-translations.js --dry-run
 *   node scripts/sync-i18n-translations.js --write --locales=ja,de
 *   node scripts/sync-i18n-translations.js --write --fill-missing-from-en
 *   node scripts/sync-i18n-translations.js --write --translate-stale-english --locales=zh-Hant --namespaces=triggers
 *
 * Env (optional defaults): `OPENAI_BASE_URL` or `AIHUBMIX_BASE_URL` (default https://api.openai.com/v1); `OPENAI_MODEL` (default gpt-4o-mini). Key: `OPENAI_API_KEY` or `AIHUBMIX_API_KEY`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EN_US_NAMESPACE_ORDER,
  flattenLeaves,
  getLocalesDir,
  isLikelyUntranslatedEnglishCopy,
  listLocaleFolders,
  loadEnUsFlat,
  loadLocaleNamespaces,
} from './lib/i18n-locales.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Merge `.env` then `.env.local` (later file overrides for duplicate keys). Assign only when
 * `process.env[key]` is unset so the shell always wins.
 * @param {string} root
 */
function applyLocalEnvFiles(root) {
  /** @param {string} fp */
  function parseFile(fp) {
    if (!fs.existsSync(fp)) return {};
    /** @type {Record<string, string>} */
    const out = {};
    const text = fs.readFileSync(fp, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      if (!key) continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  }
  const merged = {
    ...parseFile(path.join(root, '.env')),
    ...parseFile(path.join(root, '.env.local')),
  };
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

/** OpenAI-compatible API (OpenAI or AiHubMix). Key from env / .env.local (see applyLocalEnvFiles). */
function translationApiKey() {
  return process.env.OPENAI_API_KEY || process.env.AIHUBMIX_API_KEY || '';
}

function translationApiBaseUrl() {
  const raw =
    process.env.OPENAI_BASE_URL ||
    process.env.AIHUBMIX_BASE_URL ||
    'https://api.openai.com/v1';
  return raw.replace(/\/$/, '');
}

const LOCALE_LABEL = {
  ar: 'Arabic',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
};

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const o = {
    dryRun: argv.includes('--dry-run'),
    write: argv.includes('--write'),
    retranslate: argv.includes('--retranslate'),
    fillMissingFromEn: argv.includes('--fill-missing-from-en'),
    translateStaleEnglish: argv.includes('--translate-stale-english'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
  for (const a of argv) {
    if (a.startsWith('--locales=')) o.locales = a.slice('--locales='.length);
    if (a.startsWith('--namespaces='))
      o.namespaces = a.slice('--namespaces='.length);
  }
  return o;
}

function printHelp() {
  console.log(`sync-i18n-translations.js — align locale JSON with en-us

Options:
  --dry-run                  show planned work (no API, no writes)
  --write                    write locale JSON files
  --locales=ja,de            comma-separated folders under src/i18n/locales/
  --namespaces=layout,chat   limit to these namespaces
  --fill-missing-from-en       copy English text for keys missing in target (no OpenAI)
  --translate-stale-english    re-translate keys whose value still matches English (same heuristic as check:i18n [untranslated])
  --retranslate                replace all string values using OpenAI from English (destructive)
  -h, --help

API: use OPENAI_API_KEY or AIHUBMIX_API_KEY plus optional *_BASE_URL in repo root .env / .env.local (gitignored), or export in the shell (exports win). Or --fill-missing-from-en (no API).
`);
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getLeaf(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function deleteMissingLeavesSync(targetObj, refObj) {
  const refKeys = new Set(flattenLeaves(refObj));
  const tgtKeys = [...flattenLeaves(targetObj)];
  for (const k of tgtKeys) {
    if (!refKeys.has(k)) {
      const parts = k.split('.');
      let cur = targetObj;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur?.[parts[i]];
      }
      if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
    }
  }
}

function stripEmptyContainers(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const k of Object.keys(obj)) {
    stripEmptyContainers(obj[k]);
    const v = obj[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === 0
    ) {
      delete obj[k];
    }
  }
}

async function translateBatch(strings, targetLangName) {
  const apiKey = translationApiKey();
  const base = translationApiBaseUrl();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a professional UI translator. Translate JSON values from English to ${targetLangName}. Preserve placeholders exactly: {{name}}, {{count}}, and similar. Return only valid JSON: one object with the same keys as input and translated string values.`,
      },
      {
        role: 'user',
        content: JSON.stringify(strings, null, 2),
      },
    ],
    temperature: 0.3,
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }
  const data = await res.json();
  let raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Empty OpenAI response');
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(raw);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function computeOpenAiPlanned(
  opts,
  localeList,
  localesDir,
  enMerged,
  nsFilter
) {
  if (
    opts.fillMissingFromEn &&
    !opts.translateStaleEnglish &&
    !opts.retranslate
  )
    return false;
  if (opts.retranslate) return true;

  for (const loc of localeList) {
    const tgt = loadLocaleNamespaces(path.join(localesDir, loc));
    for (const ns of EN_US_NAMESPACE_ORDER) {
      if (nsFilter && !nsFilter.has(ns)) continue;
      const enObj = /** @type {Record<string, unknown>} */ (enMerged[ns] || {});
      const tObj = /** @type {Record<string, unknown>} */ (tgt[ns] || {});
      const enKeys = flattenLeaves(enObj);
      const tFlat = new Set(flattenLeaves(tObj));
      for (const k of enKeys) {
        if (!tFlat.has(k)) {
          if (!opts.fillMissingFromEn) return true;
        } else if (opts.translateStaleEnglish) {
          const v = getLeaf(enObj, k.split('.'));
          const locV = getLeaf(tObj, k.split('.'));
          if (
            typeof v === 'string' &&
            typeof locV === 'string' &&
            locV === v &&
            isLikelyUntranslatedEnglishCopy(v)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

async function main() {
  applyLocalEnvFiles(projectRoot);

  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.dryRun === opts.write) {
    console.error('Specify exactly one of: --dry-run or --write');
    process.exit(1);
  }

  const { merged: enMerged, errors } = loadEnUsFlat(projectRoot);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  const localesDir = getLocalesDir(projectRoot);
  let localeList = listLocaleFolders(projectRoot);
  if (typeof opts.locales === 'string' && opts.locales.trim()) {
    const want = new Set(
      opts.locales
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    localeList = localeList.filter((l) => want.has(l));
  }

  /** @type {Set<string> | null} */
  let nsFilter = null;
  if (typeof opts.namespaces === 'string' && opts.namespaces.trim()) {
    nsFilter = new Set(
      opts.namespaces
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  if (opts.retranslate && opts.fillMissingFromEn) {
    console.error('Use only one of --retranslate or --fill-missing-from-en');
    process.exit(1);
  }

  const openAiPlanned = computeOpenAiPlanned(
    opts,
    localeList,
    localesDir,
    enMerged,
    nsFilter
  );

  if (opts.write && openAiPlanned && !translationApiKey()) {
    console.error(
      'OPENAI_API_KEY or AIHUBMIX_API_KEY is required (set in `.env.local`, `.env`, or export). Or use --fill-missing-from-en only.'
    );
    process.exit(1);
  }

  for (const loc of localeList) {
    const label = LOCALE_LABEL[loc] || loc;
    const locPath = path.join(localesDir, loc);

    for (const ns of EN_US_NAMESPACE_ORDER) {
      if (nsFilter && !nsFilter.has(ns)) continue;
      const enObj = /** @type {Record<string, unknown>} */ (
        JSON.parse(JSON.stringify(enMerged[ns] || {}))
      );
      const enKeys = flattenLeaves(enObj);

      /** @type {Record<string, unknown>} */
      let tObj;
      if (opts.retranslate) {
        tObj = JSON.parse(JSON.stringify(enObj));
      } else {
        tObj = JSON.parse(
          JSON.stringify(loadLocaleNamespaces(locPath)[ns] || {})
        );
      }

      /** @type {Map<string, string>} */
      const toTranslate = new Map();

      if (opts.retranslate) {
        for (const k of enKeys) {
          const v = getLeaf(enObj, k.split('.'));
          if (typeof v === 'string') toTranslate.set(k, v);
        }
      } else {
        const tFlat = new Set(flattenLeaves(tObj));
        for (const k of enKeys) {
          if (!tFlat.has(k)) {
            const v = getLeaf(enObj, k.split('.'));
            if (opts.fillMissingFromEn || typeof v !== 'string') {
              setDeep(tObj, k, v);
            } else {
              toTranslate.set(k, v);
            }
          } else if (opts.translateStaleEnglish) {
            const v = getLeaf(enObj, k.split('.'));
            const locV = getLeaf(tObj, k.split('.'));
            if (
              typeof v === 'string' &&
              typeof locV === 'string' &&
              locV === v &&
              isLikelyUntranslatedEnglishCopy(v)
            ) {
              toTranslate.set(k, v);
            }
          }
        }
      }

      if (
        toTranslate.size > 0 &&
        (!opts.fillMissingFromEn ||
          opts.translateStaleEnglish ||
          opts.retranslate)
      ) {
        const chunkSize = 35;
        const entries = [...toTranslate.entries()];
        for (let i = 0; i < entries.length; i += chunkSize) {
          const slice = entries.slice(i, i + chunkSize);
          const obj = Object.fromEntries(slice);
          if (opts.dryRun) {
            console.log(
              `[dry-run] ${loc}/${ns}: OpenAI translate ${slice.length} keys`
            );
          } else {
            const out = await translateBatch(obj, label);
            for (const [k, v] of Object.entries(out)) {
              if (typeof v === 'string') setDeep(tObj, k, v);
            }
            await sleep(350);
          }
        }
      }

      if (opts.dryRun && opts.fillMissingFromEn) {
        const baseT = JSON.parse(
          JSON.stringify(loadLocaleNamespaces(locPath)[ns] || {})
        );
        const tFlat = new Set(flattenLeaves(baseT));
        let n = 0;
        for (const k of enKeys) {
          if (!tFlat.has(k)) n++;
        }
        if (n)
          console.log(
            `[dry-run] ${loc}/${ns}: copy ${n} missing keys from English`
          );
      }

      deleteMissingLeavesSync(tObj, enObj);
      stripEmptyContainers(tObj);

      if (opts.write) {
        const fp = path.join(locPath, `${ns}.json`);
        fs.writeFileSync(fp, `${JSON.stringify(tObj, null, 2)}\n`, 'utf8');
        console.log(`Wrote ${path.relative(projectRoot, fp)}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
