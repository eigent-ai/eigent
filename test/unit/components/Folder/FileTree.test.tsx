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
import { FileTree } from '../../../../src/components/Folder/index';

describe('FileTree', () => {
  const onToggleFolder = vi.fn();
  const onSelectFile = vi.fn();

  const nodeWithFolderAndFile = {
    name: '',
    path: '',
    children: [
      { name: 'src', path: '/proj/src', isFolder: true, children: [] },
      { name: 'readme.md', path: '/proj/readme.md', isFolder: false },
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
        isShowSourceCode={false}
      />
    );
    expect(screen.getByRole('button', { name: /src/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /readme\.md/i })
    ).toBeInTheDocument();
  });

  it('uses consistent first-column box (h-4 w-4) for folder and file rows for alignment', () => {
    const { container } = render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    buttons.forEach((btn) => {
      const firstCol = btn.querySelector('[class*="h-4"][class*="w-4"]');
      expect(firstCol).toBeInTheDocument();
    });
  });

  it('uses gap-2 on row for consistent spacing between chevron, icon, and label', () => {
    const { container } = render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.className).toMatch(/gap-2/);
    });
  });

  it('file row first column has aria-hidden for accessibility', () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    const fileButton = screen.getByRole('button', { name: /readme\.md/i });
    const spacer = fileButton.querySelector('[aria-hidden="true"]');
    expect(spacer).toBeInTheDocument();
  });

  it('calls onToggleFolder when folder row is clicked', async () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /src/i }));
    expect(onToggleFolder).toHaveBeenCalledWith('/proj/src');
  });

  it('calls onSelectFile when file row is clicked', async () => {
    render(
      <FileTree
        node={nodeWithFolderAndFile}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /readme\.md/i }));
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
        node={{ name: '', path: '', children: [] }}
        selectedFile={null}
        expandedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        isShowSourceCode={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
