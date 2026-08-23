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

import { FileViewerPanel } from '@/components/Folder';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ChatBox/MessageItem/MarkDown', () => ({
  MarkDown: ({ content, profile }: { content: string; profile?: string }) => (
    <article data-markdown-profile={profile}>{content}</article>
  ),
}));

vi.mock('@/components/CodeViewer/SourceCodeViewer', () => ({
  SourceCodeViewer: ({
    value,
    path,
    appearance,
  }: {
    value: string;
    path: string;
    appearance: string;
  }) => (
    <pre
      data-testid="source-code-viewer"
      data-path={path}
      data-appearance={appearance}
    >
      {value}
    </pre>
  ),
}));

type ViewerFile = NonNullable<
  ComponentProps<typeof FileViewerPanel>['selectedFile']
>;

const callbacks = {
  onRevealFile: vi.fn(),
  onDownloadFile: vi.fn(),
  onOpenExternalFile: vi.fn(),
  onToggleSourceCode: vi.fn(),
};

function textFile(overrides: Partial<ViewerFile> = {}): ViewerFile {
  return {
    name: 'notes.txt',
    path: '/workspace/notes.txt',
    relativePath: 'notes.txt',
    type: 'txt',
    content: 'hello from the file',
    ...overrides,
  };
}

function renderViewer(
  selectedFile: ViewerFile | null,
  overrides: Partial<ComponentProps<typeof FileViewerPanel>> = {}
) {
  return render(
    <FileViewerPanel
      selectedFile={selectedFile}
      loading={false}
      isShowSourceCode={false}
      breadcrumbSegments={selectedFile ? ['Workspace', selectedFile.name] : []}
      projectFiles={[]}
      {...callbacks}
      {...overrides}
    />
  );
}

describe('FileViewerPanel toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates a long file path instead of showing a scrollbar', () => {
    renderViewer(
      textFile({
        name: 'a-very-long-document-name-that-should-ellipsis.md',
      })
    );

    const breadcrumb = screen.getByRole('navigation', { name: 'File path' });
    expect(breadcrumb).toHaveClass('overflow-hidden');
    expect(breadcrumb).not.toHaveClass('scrollbar-always-visible');
    expect(breadcrumb).not.toHaveClass('overflow-x-auto');
    expect(
      screen.getByText('a-very-long-document-name-that-should-ellipsis.md')
    ).toHaveClass('truncate');
  });

  it('does not render file actions until a file is selected', () => {
    renderViewer(null);

    expect(screen.queryByRole('navigation', { name: 'File path' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Copy file content' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download file' })).toBeNull();
  });

  it('shows Open in as the only text-file action', () => {
    renderViewer(textFile(), {
      openInActions: [
        {
          id: 'finder',
          label: 'Show in Finder',
          icon: <span aria-hidden>F</span>,
          onSelect: vi.fn(),
        },
      ],
    });

    const openInButton = screen.getByRole('button', { name: 'Open in' });
    expect(openInButton).toHaveClass('bg-ds-accent-strong-default');
    expect(openInButton.firstChild?.nodeName).toBe('#text');
    expect(openInButton.querySelectorAll('svg')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Copy file content' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download file' })).toBeNull();
  });

  it('renders ordinary text through the shared source viewer', () => {
    renderViewer(textFile());

    const source = screen.getByTestId('source-code-viewer');
    expect(source).toHaveAttribute('data-path', 'notes.txt');
    expect(source).toHaveAttribute('data-appearance', 'light');
    expect(source).toHaveTextContent('hello from the file');
  });

  it('shows Preview and Source as a current-state control', async () => {
    const user = userEvent.setup();
    renderViewer(
      textFile({
        name: 'report.md',
        path: '/workspace/report.md',
        relativePath: 'report.md',
        type: 'md',
        content: '# Report',
      })
    );

    const previewButton = screen.getByRole('button', { name: 'Preview' });
    const sourceButton = screen.getByRole('button', { name: 'Source' });
    expect(previewButton).toHaveAttribute('aria-pressed', 'true');
    expect(sourceButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('# Report')).toHaveAttribute(
      'data-markdown-profile',
      'document'
    );

    await user.click(sourceButton);

    expect(callbacks.onToggleSourceCode).toHaveBeenCalledTimes(1);
    expect(callbacks.onRevealFile).not.toHaveBeenCalled();
  });

  it('orders view mode, Open in, and file-tree controls from left to right', () => {
    renderViewer(
      textFile({
        name: 'report.md',
        path: '/workspace/report.md',
        relativePath: 'report.md',
        type: 'md',
        content: '# Report',
      }),
      {
        openInActions: [
          {
            id: 'finder',
            label: 'Show in Finder',
            icon: <span aria-hidden>F</span>,
            onSelect: vi.fn(),
          },
        ],
        isFileTreeOpen: true,
        onToggleFileTree: vi.fn(),
        fileTreeControlsId: 'file-tree-controls-test',
      }
    );

    const sourceButton = screen.getByRole('button', { name: 'Source' });
    const openInButton = screen.getByRole('button', { name: 'Open in' });
    const foldButton = screen.getByRole('button', { name: 'Hide file tree' });

    expect(
      sourceButton.compareDocumentPosition(openInButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      openInButton.compareDocumentPosition(foldButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('marks Source as active when a rich file is showing source', () => {
    renderViewer(
      textFile({
        name: 'page.html',
        path: '/workspace/page.html',
        relativePath: 'page.html',
        type: 'html',
        content: '<h1>Page</h1>',
      }),
      { isShowSourceCode: true }
    );

    const previewButton = screen.getByRole('button', { name: 'Preview' });
    const sourceButton = screen.getByRole('button', { name: 'Source' });
    expect(previewButton).toHaveAttribute('aria-pressed', 'false');
    expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('source-code-viewer')).toHaveAttribute(
      'data-path',
      'page.html'
    );
  });

  it('keeps the external-content consent card readable', () => {
    renderViewer(
      textFile({
        name: 'remote-report.html',
        path: '/workspace/remote-report.html',
        relativePath: 'remote-report.html',
        type: 'html',
        content:
          '<script type="module">import "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";</script>',
      })
    );

    const heading = screen.getByRole('heading', {
      name: 'This HTML uses external content',
    });
    const consentCard = heading.parentElement?.parentElement?.parentElement;

    expect(consentCard).toHaveClass('w-full', 'max-w-[36rem]');
    expect(consentCard).not.toHaveClass('max-w-xl');
    expect(
      screen.getByRole('button', { name: 'Load external content' })
    ).toBeInTheDocument();
  });

  it('hides source switching and removed toolbar actions for a local blocked file', () => {
    renderViewer(
      textFile({
        name: 'blocked.md',
        path: '/workspace/blocked.md',
        relativePath: 'blocked.md',
        type: 'md',
        content: undefined,
        preview: {
          kind: 'blocked',
          reason: 'too-large',
          size: 100,
          limit: 50,
        },
      })
    );

    expect(
      screen.queryByRole('button', { name: 'Copy file content' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download file' })).toBeNull();
  });

  it('keeps folder destinations available while hiding file-only actions', async () => {
    const user = userEvent.setup();
    const openFolder = vi.fn();
    renderViewer(
      textFile({ name: 'src', path: 'src', type: '', isFolder: true }),
      {
        openInActions: [
          {
            id: 'finder',
            label: 'Open in Finder',
            icon: <span aria-hidden>F</span>,
            onSelect: openFolder,
          },
        ],
      }
    );

    expect(screen.getByRole('button', { name: 'Open in' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy file content' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download file' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open in' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Open in Finder' })
    );
    expect(openFolder).toHaveBeenCalledTimes(1);
  });
});
