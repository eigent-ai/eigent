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

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { appearance: string }) => unknown) =>
    selector({ appearance: 'light' }),
}));

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

  it('copies the original code after syntax highlighting', async () => {
    render(
      <MarkDown
        content={'```typescript\nconst value = 1;\n```'}
        enableTypewriter={false}
      />
    );

    const copy = await screen.findByRole('button', { name: 'Copy' });
    await waitFor(() => expect(mocks.highlight).toHaveBeenCalled());
    fireEvent.click(copy);

    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith('const value = 1;')
    );
  });

  it('uses the compact profile for workflow details', async () => {
    const { container } = render(
      <WorkflowMarkDown content="**Tool output**" enableTypewriter={false} />
    );

    await screen.findByText('Tool output');
    expect(container.querySelector('.markdown-profile-compact')).not.toBeNull();
  });
});
