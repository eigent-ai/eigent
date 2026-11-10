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

import '@/style/codeEditor.css';
import fontStacks from '@/style/fontStacks.json';
import type * as Monaco from 'monaco-editor';

export const CODE_FONT_FAMILY = fontStacks.code.join(', ');
export const CODE_FONT_SIZE = 13;
export const CODE_LINE_HEIGHT = 20;

export const CODE_THEME_NAMES = {
  light: 'eigent-github-light',
  dark: 'eigent-github-dark',
} as const;

export interface LanguageDescriptor {
  id: string;
  extensions?: readonly string[];
  filenames?: readonly string[];
}

/** Resolve a Monaco language by exact filename, then longest extension. */
export function languageForPath(
  path: string,
  languages: readonly LanguageDescriptor[]
): string {
  const fileName = path.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!fileName) return 'plaintext';
  const lowerName = fileName.toLowerCase();

  for (const language of languages) {
    if (language.filenames?.some((name) => name.toLowerCase() === lowerName))
      return language.id;
  }

  // Longest extension first so `.d.ts`-style compound extensions win over `.ts`.
  let best: { id: string; length: number } | null = null;
  for (const language of languages) {
    for (const extension of language.extensions ?? []) {
      if (!extension.startsWith('.')) continue;
      const lowerExtension = extension.toLowerCase();
      if (!lowerName.endsWith(lowerExtension)) continue;
      if (lowerName === lowerExtension) continue;
      if (!best || lowerExtension.length > best.length)
        best = { id: language.id, length: lowerExtension.length };
    }
  }
  return best?.id ?? 'plaintext';
}

export function codeThemeForAppearance(appearance: string) {
  return appearance === 'dark' ? CODE_THEME_NAMES.dark : CODE_THEME_NAMES.light;
}

/** Shared read-only options for file source and review surfaces. */
export const READ_ONLY_CODE_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions =
  {
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    scrollBeyondLastLine: false,
    scrollbar: {
      alwaysConsumeMouseWheel: false,
      horizontalScrollbarSize: 10,
      verticalScrollbarSize: 10,
    },
    contextmenu: false,
    folding: false,
    fontFamily: CODE_FONT_FAMILY,
    fontSize: CODE_FONT_SIZE,
    lineHeight: CODE_LINE_HEIGHT,
    lineNumbersMinChars: 4,
    lineDecorationsWidth: 8,
    renderLineHighlight: 'none',
    renderValidationDecorations: 'off',
    renderWhitespace: 'selection',
    // Read-only previews routinely contain CJK full-width punctuation and
    // mathematical symbols. Monaco otherwise outlines those as ASCII
    // confusables, creating distracting orange boxes throughout documents.
    // Keep warnings for truly invisible characters, which can still conceal
    // meaningful source text, without flagging normal international content.
    unicodeHighlight: {
      ambiguousCharacters: false,
      nonBasicASCII: false,
      invisibleCharacters: true,
    },
    guides: { indentation: false },
    stickyScroll: { enabled: false },
    wordWrap: 'off',
    padding: { top: 8, bottom: 8 },
  };

type MonacoApi = typeof Monaco;

/**
 * Register scoped GitHub/Primer-inspired themes on the supplied Monaco API.
 * Re-registering a named theme is safe and keeps independently loaded Monaco
 * entry points deterministic.
 */
export function registerCodeThemes(monaco: MonacoApi): void {
  monaco.editor.defineTheme(CODE_THEME_NAMES.light, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '59636E' },
      { token: 'keyword', foreground: 'CF222E' },
      { token: 'number', foreground: '0550AE' },
      { token: 'string', foreground: '0A3069' },
      { token: 'type', foreground: '8250DF' },
      { token: 'type.identifier', foreground: '8250DF' },
      { token: 'identifier', foreground: '1F2328' },
      { token: 'tag', foreground: '116329' },
      { token: 'attribute.name', foreground: '953800' },
      { token: 'delimiter', foreground: '59636E' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1F2328',
      'editorGutter.background': '#F6F8FA',
      'editorLineNumber.foreground': '#8C959F',
      'editorLineNumber.activeForeground': '#59636E',
      'editor.selectionBackground': '#0969DA33',
      'editor.inactiveSelectionBackground': '#0969DA1A',
      'editor.lineHighlightBackground': '#F6F8FA',
      'editorIndentGuide.background1': '#D1D9E0',
      'editorWhitespace.foreground': '#D1D9E0',
      'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#D1D9E0',
      'diffEditor.insertedLineBackground': '#DAFBE1',
      'diffEditor.removedLineBackground': '#FFEBE9',
      'diffEditor.insertedTextBackground': '#ACEEBB99',
      'diffEditor.removedTextBackground': '#FFCECB99',
      'diffEditorGutter.insertedLineBackground': '#ACEEBB',
      'diffEditorGutter.removedLineBackground': '#FFCECB',
      'diffEditor.unchangedRegionBackground': '#F6F8FA',
      'diffEditor.unchangedRegionForeground': '#59636E',
      'diffEditor.unchangedRegionShadow': '#D1D9E0',
      'diffEditor.diagonalFill': '#D1D9E080',
      'scrollbarSlider.background': '#818B9833',
      'scrollbarSlider.hoverBackground': '#818B9855',
      'scrollbarSlider.activeBackground': '#818B9877',
    },
  });

  monaco.editor.defineTheme(CODE_THEME_NAMES.dark, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8B949E' },
      { token: 'keyword', foreground: 'FF7B72' },
      { token: 'number', foreground: '79C0FF' },
      { token: 'string', foreground: 'A5D6FF' },
      { token: 'type', foreground: 'D2A8FF' },
      { token: 'type.identifier', foreground: 'D2A8FF' },
      { token: 'identifier', foreground: 'E6EDF3' },
      { token: 'tag', foreground: '7EE787' },
      { token: 'attribute.name', foreground: 'FFA657' },
      { token: 'delimiter', foreground: '8B949E' },
    ],
    colors: {
      'editor.background': '#0D1117',
      'editor.foreground': '#E6EDF3',
      'editorGutter.background': '#161B22',
      'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#8B949E',
      'editor.selectionBackground': '#58A6FF33',
      'editor.inactiveSelectionBackground': '#58A6FF1A',
      'editor.lineHighlightBackground': '#161B22',
      'editorIndentGuide.background1': '#30363D',
      'editorWhitespace.foreground': '#30363D',
      'editorWidget.background': '#161B22',
      'editorWidget.border': '#30363D',
      'diffEditor.insertedLineBackground': '#2EA04326',
      'diffEditor.removedLineBackground': '#F8514926',
      'diffEditor.insertedTextBackground': '#2EA04366',
      'diffEditor.removedTextBackground': '#F8514966',
      'diffEditorGutter.insertedLineBackground': '#23863666',
      'diffEditorGutter.removedLineBackground': '#DA363366',
      'diffEditor.unchangedRegionBackground': '#161B22',
      'diffEditor.unchangedRegionForeground': '#8B949E',
      'diffEditor.unchangedRegionShadow': '#30363D',
      'diffEditor.diagonalFill': '#30363D80',
      'scrollbarSlider.background': '#6E768133',
      'scrollbarSlider.hoverBackground': '#6E768155',
      'scrollbarSlider.activeBackground': '#6E768177',
    },
  });
}
