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

import { ArtifactChangeList } from '@/components/ChatBox/MessageItem/ArtifactChangeList';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function file(name: string, artifactChange?: FileInfo['artifactChange']) {
  return {
    name,
    path: `/workspace/${name}`,
    relativePath: `src/${name}`,
    type: 'File',
    artifactChange,
  } satisfies FileInfo;
}

describe('ArtifactChangeList', () => {
  it('preserves the collapsed legacy file list and opens the selected file', () => {
    const onOpen = vi.fn();
    const onViewChanges = vi.fn();
    const files = [
      file('one.ts', 'changed'),
      file('two.ts', 'generated'),
      file('three.ts'),
      file('four.ts', 'changed'),
    ];

    render(
      <ArtifactChangeList
        files={files}
        onOpen={onOpen}
        onViewChanges={onViewChanges}
        totals={{ added: 15, removed: 1 }}
        lineChangesForFile={(item) =>
          item.name === 'one.ts' ? { added: 4, removed: 2 } : null
        }
      />
    );

    expect(screen.getByText('Edited 4 files')).toBeInTheDocument();
    expect(screen.getByText('+15')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
    const firstRow = screen.getByTitle('src/one.ts');
    expect(within(firstRow).getByText('+4')).toBeInTheDocument();
    expect(within(firstRow).getByText('−2')).toBeInTheDocument();
    expect(screen.queryByTitle('src/four.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('src/two.ts'));
    expect(onOpen).toHaveBeenCalledWith(files[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onViewChanges).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more file' }));
    expect(screen.getByTitle('src/four.ts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show fewer files' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders an incomplete-manifest warning even when no files are available', () => {
    render(
      <ArtifactChangeList
        files={[]}
        onOpen={() => {}}
        scanStatus="workspace_unavailable"
      />
    );

    expect(screen.getByText('Edited 0 files')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The original local workspace is unavailable. This durable file manifest may be incomplete.'
      )
    ).toBeInTheDocument();
  });

  it('renders unresolved Artifact identity without an open capability', () => {
    const onOpen = vi.fn();
    const unresolved = file('display-only.ts', 'generated');
    render(
      <ArtifactChangeList
        files={[unresolved]}
        onOpen={onOpen}
        canOpenFile={() => false}
      />
    );

    const row = screen.getByTitle('src/display-only.ts');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('data-artifact-preview', 'unavailable');
    expect(row.tagName).toBe('DIV');
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders nothing for an empty complete manifest', () => {
    const { container } = render(
      <ArtifactChangeList files={[]} onOpen={() => {}} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
