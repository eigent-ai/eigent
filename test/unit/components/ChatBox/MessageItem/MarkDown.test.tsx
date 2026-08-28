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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { MarkDown as WorkflowMarkDown } from '@/components/WorkFlow/MarkDown';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  highlight: vi.fn(async () => '<span class="mtk1">highlighted</span>'),
  copy: vi.fn(async () => undefined),
}));

vi.mock('@/host', () => ({ useHost: () => null }));

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (
    selector: (state: {
      openFilePreview: () => void;
      openBrowserPreview: () => void;
    }) => unknown
  ) =>
    selector({
      openFilePreview: vi.fn(),
      openBrowserPreview: vi.fn(),
    }),
}));

vi.mock('@/lib/markdownSyntaxHighlight', () => ({
  highlightMarkdownCode: mocks.highlight,
}));

describe('shared MarkDown renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete document.documentElement.dataset.theme;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.copy },
    });
  });

  it('renders document Markdown with a labeled, highlighted code shell', async () => {
    const { container } = render(
      <MarkDown
        content={
          '# Example\n\n```typescript\nconst value: number = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| one | 1 |'
        }
        enableTypewriter={false}
        profile="document"
      />
    );

    expect(await screen.findByText('typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(
      container.querySelector('.markdown-profile-document')
    ).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    await waitFor(() => expect(mocks.highlight).toHaveBeenCalled());
  });

  it('collapses and expands long code without wrapping it', async () => {
    const code = Array.from(
      { length: 21 },
      (_, index) => `const line${index} = ${index};`
    ).join('\n');
    render(
      <MarkDown
        content={`\`\`\`typescript\n${code}\n\`\`\``}
        enableTypewriter={false}
      />
    );

    const expand = await screen.findByRole('button', { name: 'Show more' });
    const block = expand.closest('.markdown-code-block');
    expect(block).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(expand);
    expect(block).toHaveAttribute('data-expanded', 'true');
    expect(expand).toHaveTextContent('Show less');
  });

  it('wraps prompt-like text while keeping programming code unwrapped', async () => {
    const { container } = render(
      <MarkDown
        content={
          '```text\nA long prompt should wrap naturally in the available conversation width.\n```\n\n```typescript\nconst value = 1;\n```'
        }
        enableTypewriter={false}
      />
    );

    await screen.findByText('text');
    const textBlock = container
      .querySelector('code.language-text')
      ?.closest('.markdown-code-block');
    const typeScriptBlock = container
      .querySelector('code.language-typescript')
      ?.closest('.markdown-code-block');
    expect(textBlock).toHaveAttribute('data-wrap-lines', 'true');
    expect(typeScriptBlock).not.toHaveAttribute('data-wrap-lines');
  });

  it('copies the original code after syntax highlighting', async () => {
    const { container } = render(
      <MarkDown
        content={'```typescript\nconst value = 1;\n```'}
        enableTypewriter={false}
      />
    );

    const copy = await screen.findByRole('button', { name: 'Copy' });
    expect(copy.querySelector('.markdown-copy-icon')).not.toBeNull();
    expect(container.querySelector('.markdown-code-action')).toBe(copy);
    await waitFor(() => expect(mocks.highlight).toHaveBeenCalled());
    fireEvent.click(copy);

    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith('const value = 1;')
    );
  });

  it('rehighlights code when the document theme changes', async () => {
    document.documentElement.dataset.theme = 'light';
    render(
      <MarkDown
        content={'```typescript\nconst value = 1;\n```'}
        enableTypewriter={false}
      />
    );

    await waitFor(() =>
      expect(mocks.highlight).toHaveBeenCalledWith(
        'const value = 1;',
        'typescript',
        'light'
      )
    );

    mocks.highlight.mockClear();
    document.documentElement.dataset.theme = 'dark';

    await waitFor(() =>
      expect(mocks.highlight).toHaveBeenCalledWith(
        'const value = 1;',
        'typescript',
        'dark'
      )
    );
  });

  it('adds a local copy icon to long prose and copies only its text', async () => {
    const content =
      'This is a deliberately long rendered paragraph that gives the user a convenient local copy action without making every short sentence in a conversation show another button. It should copy exactly this paragraph.';
    render(<MarkDown content={content} enableTypewriter={false} />);

    const copy = await screen.findByRole('button', { name: 'Copy text' });
    expect(copy.querySelector('.markdown-copy-icon')).not.toBeNull();
    fireEvent.click(copy);

    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(content));
    expect(copy).toHaveAccessibleName('Copied');
  });

  it('does not add copy controls to short prose', async () => {
    render(<MarkDown content="A short answer." enableTypewriter={false} />);

    await screen.findByText('A short answer.');
    expect(
      screen.queryByRole('button', { name: 'Copy text' })
    ).not.toBeInTheDocument();
  });

  it('uses the compact profile for workflow details', async () => {
    const { container } = render(
      <WorkflowMarkDown content="**Tool output**" enableTypewriter={false} />
    );

    await screen.findByText('Tool output');
    expect(container.querySelector('.markdown-profile-compact')).not.toBeNull();
  });
});
