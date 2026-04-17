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
 * Ensures every locale has the same JSON keys as `en-us` for each namespace file.
 * Run from repo root: `node scripts/check-i18n-locale-parity.js`
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const localesDir = path.join(projectRoot, 'src', 'i18n', 'locales');
const referenceLocale = 'en-us';

function collectJsonFiles(dir) {
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

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, p));
    } else {
      keys.push(p);
    }
  }
  return keys;
}

function main() {
  const refPath = path.join(localesDir, referenceLocale);
  if (!fs.existsSync(refPath)) {
    console.error(`Reference locale not found: ${refPath}`);
    process.exit(1);
  }

  const refFiles = collectJsonFiles(refPath);
  /** Compare layout copy only — other namespaces may intentionally diverge during rollout. */
  const refRelative = refFiles
    .map((f) => path.relative(refPath, f))
    .filter(
      (rel) => rel === 'layout.json' || rel.endsWith(`${path.sep}layout.json`)
    );

  const localeDirs = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== referenceLocale);

  let failed = false;

  for (const locale of localeDirs) {
    const locPath = path.join(localesDir, locale);
    for (const rel of refRelative) {
      const refFile = path.join(refPath, rel);
      const targetFile = path.join(locPath, rel);
      if (!fs.existsSync(targetFile)) {
        console.error(`Missing file [${locale}]: ${rel}`);
        failed = true;
        continue;
      }
      let refJson;
      let tgtJson;
      try {
        refJson = JSON.parse(fs.readFileSync(refFile, 'utf8'));
        tgtJson = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      } catch (e) {
        console.error(`Invalid JSON (${locale}/${rel}):`, e.message);
        failed = true;
        continue;
      }
      const refKeys = new Set(flattenKeys(refJson));
      const tgtKeys = new Set(flattenKeys(tgtJson));
      for (const k of refKeys) {
        if (!tgtKeys.has(k)) {
          console.error(`Missing key [${locale}] ${rel}: ${k}`);
          failed = true;
        }
      }
      for (const k of tgtKeys) {
        if (!refKeys.has(k)) {
          console.error(`Extra key [${locale}] ${rel}: ${k}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    console.error('\ncheck-i18n-locale-parity: FAILED');
    process.exit(1);
  }
  console.log('check-i18n-locale-parity: OK');
}

main();
