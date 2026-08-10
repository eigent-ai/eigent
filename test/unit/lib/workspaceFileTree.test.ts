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

import { buildWorkspaceFileTree } from '@/lib/workspaceFileTree';
import { describe, expect, it } from 'vitest';

describe('buildWorkspaceFileTree', () => {
  it('builds a sorted hierarchy rooted at the current workspace', () => {
    const files: FileInfo[] = [
      {
        name: 'summary.md',
        path: '/workspace/research/reports/summary.md',
        relativePath: 'research/reports/summary.md',
        type: 'md',
      },
      {
        name: 'README.md',
        path: '/workspace/README.md',
        relativePath: 'README.md',
        type: 'md',
      },
      {
        name: 'data.csv',
        path: '/workspace/research/data.csv',
        relativePath: 'research/data.csv',
        type: 'csv',
      },
    ];

    const tree = buildWorkspaceFileTree(files);

    expect(tree.map((node) => node.name)).toEqual(['research', 'README.md']);
    expect(tree[0].children.map((node) => node.name)).toEqual([
      'reports',
      'data.csv',
    ]);
    expect(tree[0].children[0].children[0]).toMatchObject({
      name: 'summary.md',
      relativePath: 'research/reports/summary.md',
      isFolder: false,
      file: files[0],
    });
  });

  it('gives colliding display paths distinct keys without altering labels', () => {
    const files: FileInfo[] = [
      {
        name: 'index.html',
        path: '/root-a/report/index.html',
        relativePath: 'report/index.html',
        type: 'html',
      },
      {
        name: 'index.html',
        path: '/root-b/report/index.html',
        relativePath: 'report/index.html',
        type: 'html',
      },
    ];

    const tree = buildWorkspaceFileTree(files);
    const leaves = tree[0].children;

    expect(leaves).toHaveLength(2);
    // Display labels and relative paths are unchanged...
    expect(leaves.map((node) => node.name)).toEqual([
      'index.html',
      'index.html',
    ]);
    expect(leaves.map((node) => node.relativePath)).toEqual([
      'report/index.html',
      'report/index.html',
    ]);
    // ...but the React keys are distinct so the list has no duplicate keys.
    expect(new Set(leaves.map((node) => node.key)).size).toBe(2);
  });
});
