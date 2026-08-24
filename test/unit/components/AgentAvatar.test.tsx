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

import {
  AgentAvatar,
  resolveAgentAvatarKind,
} from '@/components/Workspace/AgentAvatar';
import { FoldedAgentCard } from '@/components/Workspace/FoldedAgentCard';
import { SingleAgentList } from '@/components/Workspace/SingleAgentList';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('AgentAvatar', () => {
  it.each([
    ['single_agent', undefined, 'single'],
    ['developer_agent', undefined, 'developer'],
    ['browser_agent', undefined, 'browser'],
    ['document_agent', undefined, 'document'],
    ['multi_modal_agent', undefined, 'multi-modal'],
    ['social_media_agent', undefined, 'social-media'],
    ['agent', 'single_agent', 'single'],
    ['agent', 'Developer Agent', 'developer'],
    ['custom_writer', 'Research Writer', 'custom'],
    ['subagent', 'Research helper', 'subagent-oasis'],
  ])('maps %s / %s to %s', (agentType, agentName, expected) => {
    expect(resolveAgentAvatarKind(agentType, agentName)).toBe(expected);
  });

  it('renders a decorative image at the requested existing icon size', () => {
    const { container } = render(
      <AgentAvatar agentType="browser_agent" size="sm" />
    );
    const image = container.querySelector('img');

    expect(image).toHaveAttribute('data-agent-avatar', 'browser');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(image).toHaveClass('size-4', 'object-cover');
  });

  it('distributes ordinary subagents across the supplied animal images', () => {
    const kinds = Array.from({ length: 6 }, (_, index) =>
      resolveAgentAvatarKind(
        'subagent',
        'Research helper',
        undefined,
        undefined,
        `subagent-${index + 1}`
      )
    );

    expect(new Set(kinds).size).toBe(6);
    expect(kinds.every((kind) => kind.startsWith('subagent-'))).toBe(true);
  });

  it('uses the Gemini provider logo for Gemini-backed subagents', () => {
    const { container } = render(
      <AgentAvatar
        agentType="subagent"
        agentName="Researcher"
        provider="gemini_agents"
        avatarSeed="remote-call"
        size="sm"
      />
    );

    expect(container.querySelector('[data-agent-avatar="gemini"]')).toHaveClass(
      'size-4',
      'object-contain'
    );
  });

  it('uses the camel image in the single-agent list', () => {
    const { container } = render(<SingleAgentList />);
    const surface = container.firstElementChild;

    expect(surface).toHaveClass('size-10', 'overflow-hidden');
    expect(surface).not.toHaveClass('p-2');
    expect(container.querySelector('[data-agent-avatar="single"]')).toHaveClass(
      'size-full',
      'object-cover'
    );
  });

  it('uses a full-bleed workforce image in the compact agent card', () => {
    const browserAgent = {
      agent_id: 'browser_agent',
      name: 'Browser Agent',
      type: 'browser_agent',
      tasks: [],
      log: [],
    } as Agent;
    const { container } = render(
      <FoldedAgentCard
        agent={browserAgent}
        isActive={false}
        dimmed={false}
        compactMode
        borderless
        onSelect={() => undefined}
      />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('size-10');
    expect(button).not.toHaveClass('p-2');
    expect(
      container.querySelector('[data-agent-avatar="browser"]')
    ).toHaveClass('size-full', 'object-cover');
  });
});
