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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFileTree,
  FileTree,
  findMatchingFile,
  isSameFileIdentity,
  joinWorkspacePath,
} from '../../../../src/components/Folder/index';

describe('FileTree', () => {
  const onToggleFolder = vi.fn();
  const onSelectFile = vi.fn();

  const nodeWithFolderAndFile = {
    id: 'root',
    name: '',
    path: '',
    children: [
      {
        id: 'folder:src',
        name: 'src',
        path: '/proj/src',
        isFolder: true,
        children: [],
      },
      {
        id: 'file:readme',
        name: 'readme.md',
        path: '/proj/readme.md',
        isFolder: false,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders folder and file rows', () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
      />
    );
    expect(screen.getByRole('treeitem', { name: 'src' })).toBeInTheDocument();
    expect(
      screen.getByRole('treeitem', { name: 'readme.md' })
    ).toBeInTheDocument();
  });

  it('exposes a separate folder disclosure and selection target', async () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Expand src' }));
    expect(onToggleFolder).toHaveBeenCalledWith('/proj/src');
    expect(onSelectFile).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await userEvent.click(screen.getByRole('button', { name: 'src' }));
    expect(onToggleFolder).not.toHaveBeenCalled();
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'src',
        path: '/proj/src',
        isFolder: true,
      })
    );
  });

  it('file row first column has aria-hidden for accessibility', () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
      />
    );
    const fileRow = screen.getByRole('treeitem', { name: 'readme.md' });
    expect(fileRow.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('calls onSelectFile when file row is clicked', async () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
      />
    );
    await userEvent.click(screen.getByRole('treeitem', { name: 'readme.md' }));
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'readme.md',
        path: '/proj/readme.md',
        isFolder: false,
      })
    );
  });

  it('returns null when node has no children', () => {
    const { container } = render(
      <FileTree
        node={{ id: 'root', name: '', path: '', children: [] }}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows colored change markers only in the review variant', () => {
    const reviewTree = buildFileTree([
      {
        name: 'added.ts',
        path: 'review:added',
        type: 'ts',
        relativePath: 'src/added.ts',
        status: 'added',
      },
      {
        name: 'modified.ts',
        path: 'review:modified',
        type: 'ts',
        relativePath: 'src/modified.ts',
        status: 'modified',
      },
    ]);

    render(
      <FileTree
        node={reviewTree}
        selectedFile={null}
        expandedFolders={new Set(['src'])}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
        variant="review"
      />
    );

    expect(screen.getByLabelText('added')).toHaveTextContent('A');
    expect(screen.getByLabelText('added')).toHaveClass(
      'text-ds-text-success-default-default'
    );
    expect(screen.getByLabelText('modified')).toHaveTextContent('M');
    expect(screen.getByLabelText('modified')).toHaveClass(
      'text-ds-text-warning-default-default'
    );
  });

  it('builds task folders when files share the same filename across tasks', () => {
    const tree = buildFileTree([
      {
        name: 'report.md',
        path: 'https://example.com/files/stream?path=task_alpha%2Freport.md',
        type: 'md',
        relativePath: 'task_alpha/report.md',
        isRemote: true,
      },
      {
        name: 'report.md',
        path: 'https://example.com/files/stream?path=task_beta%2Freport.md',
        type: 'md',
        relativePath: 'task_beta/report.md',
        isRemote: true,
      },
      {
        name: 'chart.png',
        path: 'https://example.com/files/stream?path=task_alpha%2Fassets%2Fchart.png',
        type: 'png',
        relativePath: 'task_alpha/assets/chart.png',
        isRemote: true,
      },
    ]);

    expect(tree.children).toHaveLength(2);
    expect(tree.children?.map((child) => child.name)).toEqual([
      'task_alpha',
      'task_beta',
    ]);

    const alphaFolder = tree.children?.[0];
    expect(alphaFolder?.isFolder).toBe(true);
    expect(alphaFolder?.children?.map((child) => child.name)).toEqual([
      'assets',
      'report.md',
    ]);

    const assetsFolder = alphaFolder?.children?.find(
      (child) => child.name === 'assets'
    );
    expect(assetsFolder?.children?.[0]).toEqual(
      expect.objectContaining({
        name: 'chart.png',
        path: 'https://example.com/files/stream?path=task_alpha%2Fassets%2Fchart.png',
      })
    );

    const betaFolder = tree.children?.[1];
    expect(betaFolder?.children?.[0]).toEqual(
      expect.objectContaining({
        name: 'report.md',
        path: 'https://example.com/files/stream?path=task_beta%2Freport.md',
      })
    );
  });

  it('matches files by relative path before falling back to name', () => {
    const files = [
      {
        name: 'report.md',
        path: 'https://example.com/files/stream?path=task_alpha%2Freport.md',
        type: 'md',
        relativePath: 'task_alpha/report.md',
        isRemote: true,
      },
      {
        name: 'report.md',
        path: 'https://example.com/files/stream?path=task_beta%2Freport.md',
        type: 'md',
        relativePath: 'task_beta/report.md',
        isRemote: true,
      },
    ];

    const matchedFile = findMatchingFile(files, {
      name: 'report.md',
      path: 'https://old-host/files/stream?path=task_beta%2Freport.md',
      type: 'md',
      relativePath: 'task_beta/report.md',
      isRemote: true,
    });

    expect(matchedFile).toEqual(files[1]);
    expect(isSameFileIdentity(matchedFile, files[1])).toBe(true);
    expect(isSameFileIdentity(matchedFile, files[0])).toBe(false);
  });

  it('preserves original folder and file casing in tree labels', () => {
    const tree = buildFileTree([
      {
        name: 'Report.MD',
        path: 'https://example.com/files/stream?path=Task_Alpha%2FReport.MD',
        type: 'md',
        relativePath: 'Task_Alpha/Report.MD',
        isRemote: true,
      },
    ]);

    expect(tree.children?.[0]?.name).toBe('Task_Alpha');
    expect(tree.children?.[0]?.children?.[0]?.name).toBe('Report.MD');
  });

  it('joins selected folder paths without losing platform path prefixes', () => {
    expect(joinWorkspacePath('/workspace/project', 'src/nested')).toBe(
      '/workspace/project/src/nested'
    );
    expect(joinWorkspacePath('C:\\workspace\\project', 'src/nested')).toBe(
      'C:\\workspace\\project\\src\\nested'
    );
    expect(joinWorkspacePath('\\\\server\\share', 'src/nested')).toBe(
      '\\\\server\\share\\src\\nested'
    );
  });
});
