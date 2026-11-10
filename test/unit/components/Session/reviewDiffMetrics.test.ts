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

import {
  countLineChanges,
  countLineDiff,
} from '@/components/Session/PreviewPanel/tabs/review/diffMetrics';
import {
  CODE_FONT_FAMILY,
  CODE_LINE_HEIGHT,
  CODE_THEME_NAMES,
  READ_ONLY_CODE_OPTIONS,
  codeThemeForAppearance,
  languageForPath,
  type LanguageDescriptor,
} from '@/lib/codePresentation';
import { describe, expect, it } from 'vitest';

/** Mirrors what Monaco's diff computer reports (verified against it). */
const change = (
  originalStartLineNumber: number,
  originalEndLineNumber: number,
  modifiedStartLineNumber: number,
  modifiedEndLineNumber: number
) => ({
  originalStartLineNumber,
  originalEndLineNumber,
  modifiedStartLineNumber,
  modifiedEndLineNumber,
});

describe('countLineChanges', () => {
  it('counts both sides of a modification', () => {
    expect(countLineChanges([change(4, 5, 4, 6)])).toEqual({
      added: 3,
      removed: 2,
    });
  });

  it('counts a pure insertion, which Monaco reports with an end line of 0', () => {
    expect(countLineChanges([change(7, 0, 8, 9)])).toEqual({
      added: 2,
      removed: 0,
    });
  });

  it('never reports removed lines for a file that had no before content', () => {
    // A new file: Monaco diffs against a model holding one blank line, so it
    // reports the first line as replacing it. Nothing was actually removed.
    expect(
      countLineChanges([change(1, 1, 1, 3)], { originalEmpty: true })
    ).toEqual({ added: 3, removed: 0 });
  });

  it('never reports added lines for a file with no after content', () => {
    expect(
      countLineChanges([change(1, 3, 1, 1)], { modifiedEmpty: true })
    ).toEqual({ added: 0, removed: 3 });
  });

  it('reports nothing when the diff is unavailable', () => {
    expect(countLineChanges(null)).toEqual({ added: 0, removed: 0 });
    expect(countLineChanges([])).toEqual({ added: 0, removed: 0 });
  });
});

describe('languageForPath', () => {
  const languages: LanguageDescriptor[] = [
    { id: 'typescript', extensions: ['.ts', '.tsx', '.cts', '.mts'] },
    { id: 'javascript', extensions: ['.js', '.mjs'], filenames: ['jakefile'] },
    { id: 'python', extensions: ['.py'] },
    {
      id: 'dockerfile',
      extensions: ['.dockerfile'],
      filenames: ['Dockerfile'],
    },
    { id: 'shell', extensions: ['.sh', '.bash'] },
    { id: 'plaintext', extensions: ['.txt'] },
  ];

  it('resolves by extension, ignoring directories and case', () => {
    expect(languageForPath('src/app/Main.TS', languages)).toBe('typescript');
    expect(languageForPath('scripts/build.py', languages)).toBe('python');
    expect(languageForPath('a\\b\\run.sh', languages)).toBe('shell');
  });

  it('prefers an exact filename match over any extension', () => {
    expect(languageForPath('build/Dockerfile', languages)).toBe('dockerfile');
    expect(languageForPath('jakefile', languages)).toBe('javascript');
  });

  it('falls back to plain text for unknown and extensionless files', () => {
    expect(languageForPath('data.unknownext', languages)).toBe('plaintext');
    expect(languageForPath('LICENSE', languages)).toBe('plaintext');
    expect(languageForPath('', languages)).toBe('plaintext');
  });

  it('does not treat a dotfile name as an extension', () => {
    expect(languageForPath('.ts', languages)).toBe('plaintext');
  });
});

describe('code presentation', () => {
  it('uses the Primer monospace stack and GitHub-sized line grid', () => {
    expect(CODE_FONT_FAMILY).toContain('ui-monospace');
    expect(CODE_FONT_FAMILY).toContain('SF Mono');
    expect(CODE_LINE_HEIGHT).toBe(20);
    expect(READ_ONLY_CODE_OPTIONS.fontSize).toBe(13);
    expect(READ_ONLY_CODE_OPTIONS.wordWrap).toBe('off');
    expect(READ_ONLY_CODE_OPTIONS.unicodeHighlight).toEqual({
      ambiguousCharacters: false,
      nonBasicASCII: false,
      invisibleCharacters: true,
    });
  });

  it('selects a scoped light or dark theme', () => {
    expect(codeThemeForAppearance('light')).toBe(CODE_THEME_NAMES.light);
    expect(codeThemeForAppearance('dark')).toBe(CODE_THEME_NAMES.dark);
    expect(codeThemeForAppearance('system')).toBe(CODE_THEME_NAMES.light);
  });
});

describe('countLineDiff', () => {
  it('counts a pure insertion and a pure deletion', () => {
    expect(countLineDiff('a\nb\n', 'a\nx\nb\n')).toEqual({
      added: 1,
      removed: 0,
    });
    expect(countLineDiff('a\nx\nb\n', 'a\nb\n')).toEqual({
      added: 0,
      removed: 1,
    });
  });

  it('counts a replaced line as one added and one removed', () => {
    expect(countLineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it('reports nothing for identical content, with or without a final newline', () => {
    expect(countLineDiff('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(countLineDiff('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
  });

  it('treats an empty side as a whole-file add or delete', () => {
    expect(countLineDiff('', 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
    expect(countLineDiff('a\nb\nc\n', '')).toEqual({ added: 0, removed: 3 });
    expect(countLineDiff('', '')).toEqual({ added: 0, removed: 0 });
  });

  it('handles a change surrounded by identical head and tail', () => {
    const before = 'h1\nh2\nold\nt1\nt2\n';
    const after = 'h1\nh2\nnew1\nnew2\nt1\nt2\n';
    expect(countLineDiff(before, after)).toEqual({ added: 2, removed: 1 });
  });

  it('counts every line when the two sides share nothing', () => {
    expect(countLineDiff('a\nb\n', 'x\ny\nz\n')).toEqual({
      added: 3,
      removed: 2,
    });
  });

  it('stays exact on a large file with a small edit', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const before = lines.join('\n');
    const after = [
      ...lines.slice(0, 9000),
      'inserted',
      ...lines.slice(9000),
    ].join('\n');
    expect(countLineDiff(before, after)).toEqual({ added: 1, removed: 0 });
  });
});
