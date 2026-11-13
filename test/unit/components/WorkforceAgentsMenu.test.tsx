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

import { WorkforceAgentsMenu } from '@/components/Workspace/WorkforceAgentsMenu';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const agent = (agent_id: string, name: string, type = name) =>
  ({ agent_id, name, type, tasks: [], log: [], activeWebviewIds: [] }) as never;

const agents = [
  agent('developer_agent', 'Developer Agent', 'developer_agent'),
  agent('browser_agent', 'Browser Agent', 'browser_agent'),
  agent('custom-1', 'Research Buddy', 'Research Buddy'),
];

describe('WorkforceAgentsMenu', () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('shows the agent count on an information-toned button', () => {
    render(<WorkforceAgentsMenu agents={agents} onAddAgent={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '3 agents' });
    expect(trigger).toHaveTextContent('3');
    expect(trigger.className).toContain('bg-ds-bg-information-subtle-default');
    // Overlapping round avatars instead of an icon.
    expect(trigger.querySelector('svg')).toBeNull();
    const stack = trigger.querySelector('[data-workforce-agent-stack]');
    const circles = Array.from(stack?.children ?? []);
    expect(circles).toHaveLength(3);
    circles.forEach((circle, index) => {
      expect(circle).toHaveClass('rounded-full', 'ring-2');
      expect(circle.querySelector('[data-agent-avatar]')).not.toBeNull();
      if (index > 0) expect(circle).toHaveClass('-ml-1.5');
    });
  });

  it('stacks at most four avatars however many agents there are', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      agent(`custom-${i}`, `Helper ${i}`)
    );
    render(<WorkforceAgentsMenu agents={many} onAddAgent={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '6 agents' });
    expect(
      trigger.querySelector('[data-workforce-agent-stack]')?.children
    ).toHaveLength(4);
    expect(trigger).toHaveTextContent('6');
  });

  it('lists each agent with its avatar in a scrolling list, then Add agent', async () => {
    const onAddAgent = vi.fn();
    const user = userEvent.setup();
    render(<WorkforceAgentsMenu agents={agents} onAddAgent={onAddAgent} />);
    await user.click(screen.getByRole('button', { name: '3 agents' }));

    const menu = await screen.findByRole('menu');
    const list = within(menu).getByRole('group', { name: 'Agents' });
    expect(list).toHaveClass('max-h-60', 'overflow-y-auto');
    const rows = list.querySelectorAll('[data-workforce-agent-row]');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('Research Buddy');
    rows.forEach((row) =>
      expect(row.querySelector('[data-agent-avatar]')).not.toBeNull()
    );

    await user.click(within(menu).getByRole('menuitem', { name: 'Add agent' }));
    expect(onAddAgent).toHaveBeenCalledTimes(1);
  });

  it('offers Edit and Delete only for agents the user created', async () => {
    const onEditAgent = vi.fn();
    const onDeleteAgent = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkforceAgentsMenu
        agents={agents}
        onAddAgent={vi.fn()}
        onEditAgent={onEditAgent}
        onDeleteAgent={onDeleteAgent}
      />
    );
    await user.click(screen.getByRole('button', { name: '3 agents' }));
    const menu = await screen.findByRole('menu');

    // Default agents ship with the app: no actions button.
    expect(
      menu.querySelectorAll('[data-workforce-agent-actions]')
    ).toHaveLength(1);

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Actions for Research Buddy' })
    );
    // Radix submenu items select on keyboard Enter in jsdom.
    (await screen.findByRole('menuitem', { name: 'Edit' })).focus();
    await user.keyboard('{Enter}');
    expect(onEditAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'custom-1' })
    );

    await user.click(screen.getByRole('button', { name: '3 agents' }));
    const reopened = await screen.findByRole('menu');
    await user.click(
      within(reopened).getByRole('menuitem', {
        name: 'Actions for Research Buddy',
      })
    );
    // Radix submenu items select on keyboard Enter in jsdom.
    (await screen.findByRole('menuitem', { name: 'Delete' })).focus();
    await user.keyboard('{Enter}');
    expect(onDeleteAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'custom-1' })
    );
  });
});
