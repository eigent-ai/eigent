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

/**
 * Finds English product copy that bypasses i18n in runtime source files.
 *
 * This intentionally focuses on presentation boundaries: rendered JSX text,
 * text-bearing props/configuration, and native notification/confirmation
 * calls. Translation fallback text inside t()/i18n.t() is allowed; the locale
 * integrity checker separately requires the referenced resource key to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const EXCLUDED_PATH =
  /(?:^|\/)(?:i18n\/locales|lib\/themeTokens|style\/generated|stories|mocks)(?:\/|$)|(?:\.test|\.stories)\.[cm]?[jt]sx?$/;

const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'cancelText',
  'confirmText',
  'content',
  'description',
  'emptyMessage',
  'emptyText',
  'label',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

const TEXT_PROPERTIES = new Set([
  'ariaLabel',
  'cancelText',
  'confirmText',
  'content',
  'description',
  'emptyDescription',
  'emptyMessage',
  'emptyText',
  'emptyTitle',
  'eyebrow',
  'label',
  'message',
  'note',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

const PRODUCT_TEXT_CALL =
  /^(?:alert|confirm|prompt|window\.(?:alert|confirm|prompt)|toast\.(?:error|info|loading|message|success|warning))$/;

// Every exception must identify one exact finding and its expected count. This
// list should stay small and limited to intentional brands, protocol/code
// samples, native language self-names, or presentation-neutral primitives.
const NATIVE_LANGUAGE_LABELS = [
  '简体中文',
  '繁體中文',
  '日本語',
  'العربية',
  'Français',
  'Русский',
  'Español',
  '한국어',
];

const PROVIDER_METADATA_DESCRIPTIONS = [
  'Codex subscription model configuration.',
  'Google Gemini model configuration.',
  'OpenAI model configuration.',
  'Anthropic Claude API configuration',
  'Grok model configuration.',
  'ModelArk model configuration.',
  'Qwen model configuration.',
  'Z.ai model configuration.',
  'Kimi model configuration.',
  'Minimax model configuration.',
  'DeepSeek model configuration.',
  'SambaNova model configuration.',
  'Mistral model configuration.',
  'OpenRouter model configuration.',
  'AWS Bedrock model configuration.',
  'AWS Bedrock Converse model configuration. Auth: API Key (Bearer Token), or Access Key ID + Secret Access Key (+Session Token).',
  'Azure OpenAI model configuration.',
  'Baidu Ernie model configuration.',
  'OrcaRouter model configuration.',
  'Nebius Token Factory model configuration.',
  'Ant Ling model configuration',
  'OpenAI-compatible API endpoint configuration.',
];

const ALLOWLIST = [
  ...[
    'src/components/Settings/General/index.tsx',
    'src/components/TopBar/UserMenu.tsx',
  ].flatMap((file) =>
    NATIVE_LANGUAGE_LABELS.map((text) => ({
      file,
      kind: 'property:label',
      text,
      count: 1,
      reason: 'Language selectors use each language native self-name.',
    }))
  ),
  ...PROVIDER_METADATA_DESCRIPTIONS.map((text) => ({
    file: 'src/lib/llm.ts',
    kind: 'property:description',
    text,
    count: 1,
    reason:
      'Provider metadata is not rendered; Models supplies a localized description.',
  })),
  {
    file: 'src/components/Session/PreviewPanel/tabs/TerminalTab.tsx',
    kind: 'jsx-text',
    text: 'Eigent:~$',
    count: 1,
    reason: 'Terminal prompt is a product/command token, not prose.',
  },
  {
    file: 'src/components/SpaceSidebar/SpaceSwitchDropdown.tsx',
    kind: 'jsx-expression',
    text: '⌘S',
    count: 1,
    reason: 'Platform shortcut glyph is not language-dependent.',
  },
  {
    file: 'src/components/WorkspaceBundle/AgentPluginImportWizard.tsx',
    kind: 'jsx-expression',
    text: '· schema {{value}}',
    count: 1,
    reason: 'Schema is a technical metadata identifier.',
  },
  {
    file: 'src/components/WorkspaceBundle/AgentPluginImportWizard.tsx',
    kind: 'jsx-text',
    text: 'argv[',
    count: 1,
    reason: 'argv is a literal command-field identifier.',
  },
  {
    file: 'src/components/WorkspaceBundle/WorkspaceBundleInstallWizard.tsx',
    kind: 'jsx-text',
    text: 'Manifest SHA-256:',
    count: 1,
    reason: 'SHA-256 manifest label is technical metadata.',
  },
  {
    file: 'src/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog.tsx',
    kind: 'jsx-text',
    text: '· sha256:',
    count: 1,
    reason: 'sha256 is a technical metadata field name.',
  },
  {
    file: 'src/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel.tsx',
    kind: 'jsx-attribute:placeholder',
    text: 'lead, researcher',
    count: 2,
    reason: 'Examples are serialized agent IDs, not natural-language copy.',
  },
  {
    file: 'src/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel.tsx',
    kind: 'jsx-attribute:placeholder',
    text: 'repository.read, issues.read',
    count: 1,
    reason: 'Examples are serialized grant identifiers.',
  },
  {
    file: 'src/store/spaceStore.ts',
    kind: 'property:description',
    text: 'Projects created before the Space layer migration.',
    count: 1,
    reason:
      'Persisted compatibility description stays stable; presentation maps it to localized Session copy.',
  },
];

function collectSourceFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(projectRoot, absolutePath);
    if (EXCLUDED_PATH.test(relativePath)) continue;
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, output);
    } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function looksLikeProductText(value) {
  const normalized = normalizeText(value);
  const withoutDynamicValues = normalized.replaceAll('{{value}}', '').trim();
  if (withoutDynamicValues.length < 2 || !/\p{L}/u.test(withoutDynamicValues)) {
    return false;
  }
  if (/^[\w@./:+-]+$/u.test(withoutDynamicValues)) return false;
  if (
    normalized.includes('text-ds-') ||
    normalized.includes('group-[') ||
    normalized.includes('scrollbar-')
  ) {
    return false;
  }
  return true;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function callName(expression, sourceFile) {
  return expression.getText(sourceFile).replace(/\s+/g, '');
}

function isTranslationCall(node, sourceFile) {
  if (!ts.isCallExpression(node)) return false;
  const name = callName(node.expression, sourceFile);
  return name === 't' || name === 'i18n.t' || name.endsWith('.t');
}

function isInsideTranslationCall(node, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    if (isTranslationCall(current, sourceFile)) return true;
    if (ts.isStatement(current) || ts.isJsxElement(current)) return false;
  }
  return false;
}

function isInsideTrans(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current)) {
      return current.openingElement.tagName.getText() === 'Trans';
    }
  }
  return false;
}

function isInsideJsxTag(node, tagName) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current)) {
      return current.openingElement.tagName.getText() === tagName;
    }
  }
  return false;
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => `{{value}}${span.literal.text}`),
    ].join('');
  }
  return null;
}

function expressionTexts(node) {
  const direct = literalText(node);
  if (direct !== null) return [direct];
  if (ts.isConditionalExpression(node)) {
    return [
      ...expressionTexts(node.whenTrue),
      ...expressionTexts(node.whenFalse),
    ];
  }
  return [];
}

function scanFile(absolutePath) {
  const relativePath = path.relative(projectRoot, absolutePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const scriptKind = /x$/.test(path.extname(absolutePath))
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const findings = [];

  function add(node, kind, rawText) {
    const text = normalizeText(rawText);
    if (!looksLikeProductText(text)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    findings.push({ file: relativePath, line: line + 1, kind, text });
  }

  function visit(node) {
    if (ts.isJsxText(node) && !isInsideTrans(node)) {
      add(node, 'jsx-text', node.text);
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      if (TEXT_ATTRIBUTES.has(attributeName) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          add(node, `jsx-attribute:${attributeName}`, node.initializer.text);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          for (const text of expressionTexts(node.initializer.expression)) {
            add(node, `jsx-attribute:${attributeName}`, text);
          }
        }
      }
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !ts.isJsxAttribute(node.parent) &&
      !isInsideTrans(node) &&
      !isInsideJsxTag(node, 'style')
    ) {
      for (const text of expressionTexts(node.expression)) {
        add(node, 'jsx-expression', text);
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      !isInsideTranslationCall(node, sourceFile)
    ) {
      const name = propertyNameText(node.name);
      const text = literalText(node.initializer);
      if (name && TEXT_PROPERTIES.has(name) && text !== null) {
        add(node, `property:${name}`, text);
      }
    }

    if (ts.isCallExpression(node) && node.arguments[0]) {
      const name = callName(node.expression, sourceFile);
      const text = literalText(node.arguments[0]);
      if (PRODUCT_TEXT_CALL.test(name) && text !== null) {
        add(node, `call:${name}`, text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function findingId(finding) {
  return `${finding.file}\0${finding.kind}\0${finding.text}`;
}

function main() {
  const findings = collectSourceFiles(sourceRoot).flatMap(scanFile);
  const grouped = new Map();
  for (const finding of findings) {
    const id = findingId(finding);
    const group = grouped.get(id) ?? [];
    group.push(finding);
    grouped.set(id, group);
  }

  const allowedCounts = new Map(
    ALLOWLIST.map((entry) => [
      findingId(entry),
      { count: entry.count, reason: entry.reason },
    ])
  );
  const unexpected = [];

  for (const [id, group] of grouped) {
    const allowance = allowedCounts.get(id);
    const allowedCount = allowance?.count ?? 0;
    if (group.length > allowedCount) {
      unexpected.push(...group.slice(allowedCount));
    }
  }

  for (const entry of ALLOWLIST) {
    const actualCount = grouped.get(findingId(entry))?.length ?? 0;
    if (actualCount < entry.count) {
      console.error(
        `Stale i18n source allowlist entry: ${entry.file} [${entry.kind}] ` +
          `${JSON.stringify(entry.text)} expected ${entry.count}, found ${actualCount}`
      );
      process.exitCode = 1;
    }
  }

  if (unexpected.length > 0) {
    console.error(
      `Hard-coded product copy found (${unexpected.length} occurrence(s)):`
    );
    for (const finding of unexpected.sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line
    )) {
      console.error(
        `  ${finding.file}:${finding.line} [${finding.kind}] ${JSON.stringify(
          finding.text
        )}`
      );
    }
    process.exitCode = 1;
  }

  if (process.exitCode) return;
  console.log(
    `check-i18n-source-usage: OK (${findings.length} audited occurrence(s), ` +
      `${ALLOWLIST.length} documented exception(s))`
  );
}

main();
