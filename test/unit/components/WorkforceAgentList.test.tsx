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

import { WorkforceAgentList } from '@/components/Workspace/WorkforceAgentList';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Workspace/FoldedAgentCard', () => ({
  FoldedAgentCard: ({ agent }: { agent: Agent }) => (
    <button type="button">{agent.name}</button>
  ),
  isBaseWorkflowAgent: () => false,
}));

const agents = [
  { agent_id: 'agent-1', name: 'Agent 1', type: 'developer_agent' },
  { agent_id: 'agent-2', name: 'Agent 2', type: 'browser_agent' },
  { agent_id: 'agent-3', name: 'Agent 3', type: 'document_agent' },
] as Agent[];

function renderAgentList(onAddWorker = vi.fn()) {
  return {
    onAddWorker,
    ...render(
      <WorkforceAgentList
        sortedAgents={agents}
        activeAgentId={undefined}
        onSelectAgent={vi.fn()}
        onEditWorkerFromMenu={vi.fn()}
        onDuplicateUserAgent={vi.fn()}
        onDeleteUserAgent={vi.fn()}
        onAddWorker={onAddWorker}
        alignment="start"
      />
    ),
  };
}

describe('WorkforceAgentList', () => {
  it('puts Add first and hides the native horizontal scrollbar', () => {
    const { container, onAddWorker } = renderAgentList();
    const controls = container.querySelector('[data-workforce-agent-controls]');
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-workforce-add-button]'
    );
    const viewportShell = container.querySelector(
      '[data-workforce-agent-viewport-shell]'
    );
    const viewport = container.querySelector('[role="list"]');

    expect(controls?.firstElementChild).toContainElement(addButton);
    expect(controls?.lastElementChild).toBe(viewportShell);
    expect(
      container.querySelector('[data-workforce-scroll-controls]')
    ).not.toBeInTheDocument();
    expect(viewport).toHaveClass(
      'scrollbar-hide',
      'overflow-x-auto',
      'overflow-y-hidden'
    );

    fireEvent.click(addButton!);
    expect(onAddWorker).toHaveBeenCalledTimes(1);
  });

  it('scrolls exactly one agent slot with the floating arrow controls', async () => {
    const { container } = renderAgentList();
    const viewport = container.querySelector<HTMLElement>('[role="list"]')!;
    const agentItems = container.querySelectorAll<HTMLElement>(
      '[data-workforce-agent-item]'
    );
    const scrollBy = vi.fn();

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 88 },
      scrollWidth: { configurable: true, value: 136 },
      scrollLeft: { configurable: true, value: 0 },
      scrollBy: { configurable: true, value: scrollBy },
    });
    Object.defineProperty(agentItems[0], 'offsetLeft', { value: 0 });
    Object.defineProperty(agentItems[1], 'offsetLeft', { value: 48 });

    fireEvent.scroll(viewport);
    const scrollControls = await waitFor(() => {
      const controls = container.querySelector(
        '[data-workforce-scroll-controls]'
      );
      expect(controls).toBeInTheDocument();
      return controls;
    });
    const leftButton = container.querySelector<HTMLButtonElement>(
      '[data-workforce-scroll-left]'
    )!;
    const rightButton = container.querySelector<HTMLButtonElement>(
      '[data-workforce-scroll-right]'
    )!;

    expect(scrollControls).toHaveClass('top-0', '-translate-y-full');
    await waitFor(() => expect(rightButton).toBeEnabled());

    expect(leftButton).toBeDisabled();
    fireEvent.click(rightButton);
    expect(scrollBy).toHaveBeenCalledWith({
      left: 48,
      behavior: 'smooth',
    });

    Object.defineProperty(viewport, 'scrollLeft', {
      configurable: true,
      value: 48,
    });
    fireEvent.scroll(viewport);
    await waitFor(() => expect(leftButton).toBeEnabled());

    expect(rightButton).toBeDisabled();
    fireEvent.click(leftButton);
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -48,
      behavior: 'smooth',
    });
  });
});
