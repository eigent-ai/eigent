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
  getWorkspaceRelativeFilePath,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
} from '@/lib/workspaceRelativePath';
import { describe, expect, it } from 'vitest';

describe('getWorkspaceRelativeFilePath', () => {
  it('shows a normalized path relative to the workspace root', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: 'final_report.md',
        type: 'md',
        path: '/Users/test/workspace/reports/final_report.md',
        relativePath: './research\\reports\\final_report.md',
      })
    ).toBe('research/reports/final_report.md');
  });

  it('appends the file name when relativePath identifies only the directory', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: 'final_report.md',
        type: 'md',
        path: '/Users/test/workspace/reports/final_report.md',
        relativePath: 'reports',
      })
    ).toBe('reports/final_report.md');
  });

  it('never falls back to an absolute path when a file name is available', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: 'final_report.md',
        type: 'md',
        path: '/Users/test/workspace/reports/final_report.md',
      })
    ).toBe('final_report.md');
  });

  it('rejects an absolute path accidentally placed in relativePath', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: 'report.md',
        type: 'md',
        path: '/Users/test/workspace/report.md',
        relativePath: '/Users/test/workspace/report.md',
      })
    ).toBe('report.md');
  });

  it('rejects a relativePath that escapes the workspace root', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: 'secret.txt',
        type: 'txt',
        path: '/Users/test/secret.txt',
        relativePath: '../secret.txt',
      })
    ).toBe('secret.txt');
  });

  it('does not display remote preview URLs', () => {
    expect(
      getWorkspaceRelativeFilePath({
        name: '',
        type: 'csv',
        path: 'https://example.com/files/stream?path=reports%2Fdata.csv',
      })
    ).toBe('stream');
  });

  it('normalizes only safe workspace-relative identities', () => {
    expect(normalizeWorkspaceRelativePath('./reports\\final.md')).toBe(
      'reports/final.md'
    );
    expect(normalizeWorkspaceRelativePath('/workspace/final.md')).toBeNull();
    expect(
      normalizeWorkspaceRelativePath('https://example.test/final.md')
    ).toBeNull();
    expect(normalizeWorkspaceRelativePath('%2e%2e/secret.txt')).toBeNull();
    expect(normalizeWorkspaceRelativePath('reports/%2fsecret.txt')).toBeNull();
  });
});

describe('resolveWorkspaceFilePath', () => {
  it('joins a workspace root with a portable relative identity', () => {
    expect(
      resolveWorkspaceFilePath('/Users/test/workspace', 'reports/final.md')
    ).toBe('/Users/test/workspace/reports/final.md');
    expect(
      resolveWorkspaceFilePath('C:\\Users\\test\\workspace', 'reports/final.md')
    ).toBe('C:\\Users\\test\\workspace\\reports\\final.md');
  });

  it('rejects traversal, URLs, and missing roots', () => {
    expect(
      resolveWorkspaceFilePath('/Users/test/workspace', '../secret.txt')
    ).toBe('');
    expect(
      resolveWorkspaceFilePath(
        'https://example.test/workspace',
        'reports/final.md'
      )
    ).toBe('');
    expect(resolveWorkspaceFilePath('', 'reports/final.md')).toBe('');
  });
});
