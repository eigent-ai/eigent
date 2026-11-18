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

import '@/api/http';

import BottomBox from '@/components/ChatBox/BottomBox';
import {
  ContextPanel,
  type ContextPanelHandle,
} from '@/components/ChatBox/BottomBox/ContextPanel';
import { useSkillsStore } from '@/store/skillsStore';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  proxyFetchGet: vi.fn(async (url: string) =>
    url === '/api/v1/mcp/users'
      ? [
          { id: 7, mcp_name: 'Notion', status: 1 },
          { id: 8, mcp_name: 'Paused', status: 0 },
        ]
      : {}
  ),
}));
vi.mock('@/api/connectors', () => ({
  fetchConnectedProviders: vi.fn().mockResolvedValue([]),
  providerLabel: (provider: { service: string }) => provider.service,
}));
vi.mock('@/hooks/useIntegrationManagement', () => ({
  useIntegrationManagement: () => ({ installed: {} }),
}));
vi.mock('@/store/serverCapabilityStore', () => {
  const state = {
    capabilities: { features: { connector_gateway: { enabled: false } } },
    status: 'ready',
    fetchCapabilities: vi.fn(),
  };
  return {
    useServerCapabilityStore: (selector: (s: typeof state) => unknown) =>
      selector(state),
  };
});
vi.mock('@/components/ChatBox/BottomBox/BoxFooter', () => ({
  BoxFooter: () => null,
}));

const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent?.trim());

function renderPanel(
  props: Partial<React.ComponentProps<typeof ContextPanel>> = {}
) {
  const ref = createRef<ContextPanelHandle>();
  const handlers = { onUpload: vi.fn(), onPickItem: vi.fn() };
  const view = render(
    <ContextPanel
      ref={ref}
      listId="context"
      query=""
      inputValue=""
      {...handlers}
      {...props}
    />
  );
  return { ...view, ref, ...handlers };
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // The real composer measures its caret, which jsdom does not lay out.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  window.scrollTo = vi.fn() as never;
});

beforeEach(() => {
  useSkillsStore.setState({
    skills: [
      { id: 's1', name: 'docx', skillDirName: 'docx', enabled: true },
      { id: 's2', name: 'pdf', skillDirName: 'pdf', enabled: true },
      { id: 's3', name: 'off', skillDirName: 'off', enabled: false },
    ] as never,
  });
});

describe('ContextPanel', () => {
  it('lists upload first, then skills, then connectors, as plain rows', async () => {
    renderPanel();
    await screen.findByRole('option', { name: 'Notion' });

    expect(optionNames()).toEqual([
      'Add files or photos',
      'docx',
      'pdf',
      'Notion',
    ]);
    expect(
      screen.getAllByRole('group').map((group) => group.textContent)
    ).toEqual([
      expect.stringMatching(/^Skills/),
      expect.stringMatching(/^Connectors/),
    ]);
    // No inline token tags or per-row "+".
    expect(screen.getByRole('listbox')).not.toHaveTextContent('#docx');
  });

  it('filters every section by the typed keyword and highlights the top match', async () => {
    const { ref, onPickItem } = renderPanel({ query: 'NOT' });
    await screen.findByRole('option', { name: 'Notion' });

    expect(optionNames()).toEqual(['Notion']);
    expect(screen.getByRole('option', { name: 'Notion' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    act(() => {
      expect(ref.current?.pick()).toBe(true);
    });
    expect(onPickItem).toHaveBeenCalledWith(
      expect.objectContaining({ token: '@Notion' })
    );
  });

  it('says so when nothing matches', async () => {
    renderPanel({ query: 'zzz' });
    expect(
      await screen.findByText('No skills or connectors match “zzz”')
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('highlights nothing until the arrow keys move, so Enter can still send', async () => {
    const { ref, onUpload } = renderPanel();
    await screen.findByRole('option', { name: 'Notion' });
    act(() => {
      expect(ref.current?.pick()).toBe(false);
    });

    act(() => ref.current?.move(1));
    expect(
      screen.getByRole('option', { name: 'Add files or photos' })
    ).toHaveAttribute('aria-selected', 'true');
    act(() => ref.current?.move(-1));
    expect(screen.getByRole('option', { name: 'Notion' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    act(() => ref.current?.move(1));
    act(() => {
      ref.current?.pick();
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('marks items already in the prompt and skips a disabled upload row', async () => {
    const { ref } = renderPanel({
      inputValue: 'summarize #pdf ',
      uploadDisabled: true,
    });
    await screen.findByRole('option', { name: 'Notion' });

    expect(screen.getByRole('option', { name: 'pdf' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(
      screen.getByRole('option', { name: 'pdf' }).querySelector('svg')
    ).not.toBeNull();
    expect(
      screen.getByRole('option', { name: 'Add files or photos' })
    ).toHaveAttribute('aria-disabled', 'true');
    act(() => ref.current?.move(1));
    expect(screen.getByRole('option', { name: 'docx' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});

function Composer({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <BottomBox
        state="input"
        inputProps={{ value, onChange: setValue, onSend: vi.fn() }}
      />
      <output data-testid="prompt">{value}</output>
    </>
  );
}

describe('BottomBox add-context panel', () => {
  const plus = () =>
    screen.getByRole('button', { name: 'Add files, skills, or connectors' });
  const field = () => screen.getByRole('textbox');

  it('opens one floating panel and closes it again from the + button', () => {
    render(<Composer />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(plus());
    expect(plus()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(field()).toHaveAttribute(
      'aria-controls',
      screen.getByRole('listbox').id
    );

    fireEvent.click(plus());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('uses text typed after opening as the search and replaces it with the chosen token', async () => {
    render(<Composer initial="summarize this" />);
    fireEvent.click(plus());

    // Typing into the composer (simulated as a controlled edit).
    fireEvent.input(field(), { target: { textContent: 'summarize this pd' } });
    const listbox = screen.getByRole('listbox');
    await within(listbox).findByRole('option', { name: 'pdf' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent?.trim())
    ).toEqual(['pdf']);

    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByTestId('prompt')).toHaveTextContent(
      'summarize this #pdf'
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape without changing the prompt', () => {
    render(<Composer initial="hello" />);
    fireEvent.click(plus());
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt')).toHaveTextContent('hello');
  });
});
