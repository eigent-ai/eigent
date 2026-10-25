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
 * Fails if UI source renders a Lucide icon directly instead of through
 * `DsIcon`, or overrides a DsIcon's size or stroke locally. DsIcon owns the
 * two base icon styles (16px standard, 12px compact) and the shared stroke.
 *
 * Usage:
 *   node scripts/check-icon-usage.mjs
 *   node scripts/check-icon-usage.mjs src/a.tsx   # lint-staged (one or more files)
 *
 * The full run (no file arguments) also type-checks every JSX tag, so icons
 * reached through a variable, alias or object property (`const Icon = …`,
 * `<item.Icon />`) are caught too. The per-file run matches names imported
 * from 'lucide-react' only, to stay fast on commit.
 *
 * Exemption: put `ds-icon:allow <reason>` in a comment on the element's line or
 * the line above it. Reserve it for glyphs that are not icons (for example a
 * check mark drawn inside a custom badge).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const EXT = new Set(['.tsx', '.jsx']);
const SKIP_PATHS = new Set([
  'src/components/ui/ds-icon.tsx',
  'src/components/ui/ds-morph-icon.tsx',
]);
const SKIP_PREFIXES = ['src/components/ui/animate-ui/icons/'];
const SKIP_FILE_RE = /\.(test|spec)\.(tsx|jsx)$|\.stories\.(tsx|jsx)$/;

const LUCIDE_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/gs;
const DS_TAGS = ['DsIcon', 'TaskLogIcon'];
const SIZE_CLASS_RE =
  /(?<![\w:[-])(?:size|h|w)-(?:\d+(?:\.\d+)?|\[[^\]\s]+\])(?![\w.\]-])/;
const SIZE_PROP_RE = /\b(?:size|strokeWidth|absoluteStrokeWidth|width|height)=/;

function lucideNames(text) {
  const names = new Set();
  for (const m of text.matchAll(LUCIDE_IMPORT_RE)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part || part.startsWith('type ')) continue;
      names.add(
        part
          .split(/\s+as\s+/)
          .pop()
          .trim()
      );
    }
  }
  return names;
}

/** Index of the `>` that closes the opening tag starting at `from`. */
function openTagEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function exempt(lines, line) {
  return [line - 1, line - 2].some(
    (i) => i >= 0 && lines[i]?.includes('ds-icon:allow')
  );
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      yield* walk(p);
    } else if (EXT.has(e.name.slice(e.name.lastIndexOf('.')))) {
      yield p;
    }
  }
}

function checkFile(abs) {
  const rel = relative(REPO_ROOT, abs).replaceAll('\\', '/');
  if (
    SKIP_PATHS.has(rel) ||
    SKIP_PREFIXES.some((p) => rel.startsWith(p)) ||
    SKIP_FILE_RE.test(rel)
  ) {
    return [];
  }
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const out = [];

  const names = lucideNames(text);
  if (names.size > 0) {
    const tag = new RegExp(`<(${[...names].join('|')})(?=[\\s/>])`, 'g');
    for (const m of text.matchAll(tag)) {
      const end = openTagEnd(text, m.index + m[0].length);
      // TypeScript generics such as useState<File | null> are not elements.
      if (end < 0 || /[|&,]/.test(text.slice(m.index, end).split('\n')[0]))
        continue;
      const line = lineOf(text, m.index);
      if (exempt(lines, line)) continue;
      out.push({
        file: rel,
        line,
        message: `Lucide icon <${m[1]}> rendered directly. Use <DsIcon icon={${m[1]}} />.`,
      });
    }
  }

  for (const dsTag of DS_TAGS) {
    for (const m of text.matchAll(new RegExp(`<${dsTag}(?=[\\s/>])`, 'g'))) {
      const end = openTagEnd(text, m.index + m[0].length);
      if (end < 0) continue;
      const attrs = text.slice(m.index, end);
      const line = lineOf(text, m.index);
      if (exempt(lines, line)) continue;
      const classAttr = attrs.match(/className=("[^"]*"|\{[\s\S]*?\}\s*$)/m);
      if (SIZE_PROP_RE.test(attrs.replace(/illustrationSize=/g, ''))) {
        out.push({
          file: rel,
          line,
          message: `<${dsTag}> sets size or stroke locally. Choose a recipe instead.`,
        });
      } else if (classAttr && SIZE_CLASS_RE.test(classAttr[1])) {
        out.push({
          file: rel,
          line,
          message: `<${dsTag}> overrides its size with a utility class. Choose a recipe instead.`,
        });
      }
    }
  }

  out.push(...mixedSizeControls(text, lines, rel));
  return out;
}

const CONTROL_TAG_RE =
  /^(button|a|label|Button|[A-Z]\w*(Trigger|Item|Button|Toggle|Tab|Chip|Pill|Link|Option))$/;
const JSX_TAG_RE =
  /<(\/?)([A-Za-z][\w.]*)((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)(\/?)>/gs;
const DS_ICON_ELEMENT_RE =
  /<DsIcon\b((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)\/>/gs;

/**
 * One control, one icon size: a button or menu item must not mix the compact
 * (12px) and standard (16px) styles.
 */
function mixedSizeControls(text, lines, rel) {
  const stack = [];
  const controls = [];
  for (const m of text.matchAll(JSX_TAG_RE)) {
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      while (stack.length > 0) {
        const open = stack.pop();
        if (open.name === name) {
          if (CONTROL_TAG_RE.test(name)) {
            controls.push({ name, start: open.start, end: m.index });
          }
          break;
        }
      }
    } else if (!selfClosing) {
      stack.push({ name, start: m.index });
    }
  }

  const sizesByControl = new Map();
  for (const m of text.matchAll(DS_ICON_ELEMENT_RE)) {
    const recipe = /recipe="([\w-]+)"/.exec(m[1])?.[1] ?? 'main';
    if (recipe === 'illustration') continue;
    const inner = controls
      .filter((c) => c.start < m.index && c.end > m.index)
      .sort((a, b) => b.start - a.start)[0];
    if (!inner) continue;
    const entry = sizesByControl.get(inner) ?? {
      recipes: new Set(),
      at: m.index,
    };
    entry.recipes.add(recipe);
    sizesByControl.set(inner, entry);
  }

  const out = [];
  for (const [control, { recipes }] of sizesByControl) {
    if (recipes.size < 2) continue;
    const line = lineOf(text, control.start);
    if (exempt(lines, line)) continue;
    out.push({
      file: rel,
      line,
      message: `<${control.name}> mixes 12px and 16px icons. Use one recipe for every icon in a control.`,
    });
  }
  return out;
}

const LUCIDE_TYPE_RE =
  /^LucideIcon$|^ForwardRefExoticComponent<Omit<LucideProps/;
const ALLOWED_TAGS = new Set([...DS_TAGS, 'DsMorphIcon']);

/**
 * JSX tags whose own type is a Lucide icon component, however the component
 * was reached. Wrapper components that merely accept an `icon` prop are not
 * icons themselves and are skipped.
 */
function typedLucideTags() {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const configPath = join(REPO_ROOT, 'tsconfig.build.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const isLucideType = (type) =>
    (type.isUnion() ? type.types : [type]).some((t) =>
      LUCIDE_TYPE_RE.test(checker.typeToString(t))
    );

  const out = [];
  for (const sf of program.getSourceFiles()) {
    const rel = relative(REPO_ROOT, sf.fileName).replaceAll('\\', '/');
    if (
      !rel.startsWith('src/') ||
      !EXT.has(rel.slice(rel.lastIndexOf('.'))) ||
      SKIP_PATHS.has(rel) ||
      SKIP_PREFIXES.some((p) => rel.startsWith(p)) ||
      SKIP_FILE_RE.test(rel)
    ) {
      continue;
    }
    const lines = sf.text.split(/\r?\n/);
    const visit = (node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const name = node.tagName.getText(sf);
        if (
          /^[A-Z]|\./.test(name) &&
          !ALLOWED_TAGS.has(name) &&
          isLucideType(checker.getTypeAtLocation(node.tagName))
        ) {
          const line =
            sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          if (!exempt(lines, line)) {
            out.push({
              file: rel,
              line,
              message: `Lucide icon <${name}> rendered directly. Use <DsIcon icon={${name}} />.`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const explicit = argv
    .filter((a) => !a.startsWith('-'))
    .map((a) => resolve(REPO_ROOT, a))
    .filter((p) => existsSync(p) && statSync(p).isFile())
    .filter((p) => EXT.has(p.slice(p.lastIndexOf('.'))));
  const fullRun = argv.length === 0;
  const targets = fullRun ? [...walk(join(REPO_ROOT, 'src'))] : explicit;

  const violations = targets.flatMap(checkFile);
  if (fullRun) {
    // The typed pass also covers direct imports; keep one finding per element.
    const seen = new Set(violations.map((v) => `${v.file}:${v.line}`));
    for (const v of typedLucideTags()) {
      if (!seen.has(`${v.file}:${v.line}`)) violations.push(v);
    }
  }
  if (violations.length === 0) {
    console.log('check-icon-usage: OK (all icons render through DsIcon).');
    process.exit(0);
  }
  console.error('check-icon-usage: icon style violations:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}\n    ${v.message}\n`);
  }
  console.error(
    `Total: ${violations.length} finding(s). See docs/design-system/design.md §7 (Icons).`
  );
  process.exit(1);
}

main();
