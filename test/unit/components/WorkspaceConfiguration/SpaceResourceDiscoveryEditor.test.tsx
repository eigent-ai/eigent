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

import { SpaceDiscoveryField } from '@/components/WorkspaceConfiguration/SpaceDiscoveryField';
import {
  SpaceResourceDiscoveryEditor,
  type SpaceSettingsDiscovery,
} from '@/components/WorkspaceConfiguration/SpaceResourceDiscoveryEditor';
import {
  canCommitResourceEditor,
  type WorkspaceResourceEditorState,
} from '@/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel';
import type { SpaceMcpCandidate } from '@/service/spaceSettingsDiscovery';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const skill = {
  value: 'bundle://skills/research/SKILL.md',
  label: 'Research',
  source: 'materialized_bundle' as const,
  availability: 'available' as const,
};
const secondSkill = {
  ...skill,
  value: 'bundle://skills/writer/SKILL.md',
  label: 'Writer',
};
const mcpCandidate = (id: string, slot: string): SpaceMcpCandidate => {
  const definition = `bundle://mcp/${id}/mcp.json`;
  return {
    id,
    definition,
    value: JSON.stringify([definition, id]),
    label: id,
    source: 'draft_bundle',
    availability: 'requires_setup',
    secretSlots: [slot],
  };
};
const mcpA = mcpCandidate('a', 'TOKEN_A');
const mcpB = mcpCandidate('b', 'TOKEN_B');
const newMcp = (): Extract<Editor, { kind: 'mcp' }> => ({
  kind: 'mcp',
  mode: 'create',
  step: 'picker',
  item: { id: 'mcp_1', definition: '', secretSlots: [], assignTo: [] },
});
const connector = {
  value: 'github',
  service: 'github',
  label: 'GitHub',
  source: 'connector_catalog' as const,
  availability: 'available' as const,
  supportedGrants: ['repository.read'],
  connected: true,
};
const config: WorkspaceConfigurationDocument = {
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: { id: 'fixture', name: 'Fixture', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    connectors: [
      {
        id: 'existing',
        connector: 'github',
        connectionSlot: 'github_connection',
        requiredGrants: [],
      },
    ],
    mcpServers: [],
    agents: [{ id: 'lead', role: 'coordinator', modelProfile: 'default' }],
    models: {
      default: { modelRef: 'provider://default', thinkingEffort: 'medium' },
    },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: false,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'deny',
    },
  },
};
const discovery = (): SpaceSettingsDiscovery => {
  const catalog = {
    items: [],
    status: 'ready' as const,
    error: null,
    retry: vi.fn(),
  };
  return {
    models: catalog,
    skills: { ...catalog, items: [skill, secondSkill] },
    mcpServers: catalog,
    connectors: {
      ...catalog,
      scope: '',
      items: [connector],
      query: '',
      page: 1,
      hasMore: false,
      loadingMore: false,
      detailStatus: 'idle',
      detailError: null,
      fetchDetails: vi.fn().mockResolvedValue(connector),
      loadMore: vi.fn(),
      setQuery: vi.fn(),
    },
    setConnectorQuery: vi.fn(),
  };
};
type Editor = Extract<
  WorkspaceResourceEditorState,
  { kind: 'skill' | 'connector' | 'mcp' }
>;
function Harness({
  initial,
  data,
  changed,
}: {
  initial: Editor;
  data: SpaceSettingsDiscovery;
  changed: (editor: WorkspaceResourceEditorState) => void;
}) {
  const [editor, setEditor] = useState(initial);
  return (
    <SpaceResourceDiscoveryEditor
      editor={editor}
      document={config}
      discovery={data}
      onChange={(next) => {
        changed(next);
        setEditor(next as Editor);
      }}
    />
  );
}
const choose = async (title: string, option: string) => {
  const user = userEvent.setup();
  screen.getByRole('combobox', { name: title }).focus();
  await user.keyboard('[ArrowDown]');
  await user.click(screen.getByRole('option', { name: new RegExp(option) }));
};

describe('Space resource discovery drafts', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  it('prefills only a unique verified new resource, retaining empty assignments and existing false', async () => {
    const data = discovery();
    data.skills.items = [skill];
    const changed = vi.fn();
    render(
      <Harness
        initial={{
          kind: 'skill',
          mode: 'create',
          step: 'picker',
          item: { ref: '', assignTo: [] },
        }}
        data={data}
        changed={changed}
      />
    );
    expect(
      screen.getByRole('combobox', { name: 'Skill reference' })
    ).toHaveTextContent(skill.label);
    expect(screen.getByText(/Review this editable draft/)).toBeVisible();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ item: { ref: skill.value, assignTo: [] } })
    );
    expect(config.spec.git.enabled).toBe(false);
    expect(config.spec.models.default.modelRef).toBe('provider://default');
  });

  it('preserves an unknown saved reference without selecting a replacement', () => {
    const data = discovery();
    data.skills.items = [skill];
    const changed = vi.fn();
    render(
      <Harness
        initial={{
          kind: 'skill',
          mode: 'edit',
          step: 'editor',
          index: 0,
          item: { ref: 'registry://legacy@1', assignTo: [] },
        }}
        data={data}
        changed={changed}
      />
    );
    expect(
      screen.getByRole('combobox', { name: 'Skill reference' })
    ).toHaveTextContent('registry://legacy@1');
    expect(changed).not.toHaveBeenCalled();
  });

  it('explicit selection fills a unique connector slot without copying authorization grants', async () => {
    const data = discovery(),
      changed = vi.fn();
    render(
      <Harness
        initial={{
          kind: 'connector',
          mode: 'create',
          step: 'picker',
          item: {
            id: 'connector_1',
            connector: '',
            connectionSlot: '',
            requiredGrants: [],
          },
        }}
        data={data}
        changed={changed}
      />
    );
    await choose('Connector', 'GitHub');
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        step: 'editor',
        item: {
          id: 'connector_1',
          connector: 'github',
          connectionSlot: 'github_connection_2',
          requiredGrants: [],
        },
      })
    );
    expect(data.connectors.fetchDetails).toHaveBeenCalledWith('github');
    expect(
      screen.getByRole('textbox', { name: 'Required grants' })
    ).toHaveValue('');
  });

  it.each(['custom_slot', ''])(
    'preserves a user-entered then cleared or custom connection slot (%s)',
    async (slot) => {
      const data = discovery(),
        changed = vi.fn();
      render(
        <Harness
          initial={{
            kind: 'connector',
            mode: 'create',
            step: 'picker',
            item: {
              id: 'connector_1',
              connector: '',
              connectionSlot: '',
              requiredGrants: ['custom.read'],
            },
          }}
          data={data}
          changed={changed}
        />
      );
      const field = screen.getByRole('textbox', { name: 'Connection slot' });
      fireEvent.change(field, { target: { value: 'typed' } });
      fireEvent.change(field, { target: { value: slot } });
      await choose('Connector', 'GitHub');
      expect(field).toHaveValue(slot);
      expect(
        screen.getByRole('textbox', { name: 'Required grants' })
      ).toHaveValue('custom.read');
    }
  );

  it('keeps server identity distinct and serializes a logical MCP definition, never the UI option identity', () => {
    const data = discovery(),
      changed = vi.fn();
    const definition = 'bundle://mcp/servers.json';
    data.mcpServers.items = [
      {
        value: JSON.stringify([definition, 'fixture-server']),
        definition,
        id: 'fixture-server',
        label: 'Fixture server',
        source: 'materialized_bundle',
        availability: 'available',
        secretSlots: ['API_TOKEN'],
      },
    ];
    render(
      <Harness
        initial={{
          kind: 'mcp',
          mode: 'create',
          step: 'picker',
          item: { id: 'mcp_1', definition: '', secretSlots: [], assignTo: [] },
        }}
        data={data}
        changed={changed}
      />
    );
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        item: {
          id: 'fixture-server',
          definition,
          secretSlots: ['API_TOKEN'],
          assignTo: [],
        },
      })
    );
  });

  it.each(['selected', 'suggested'] as const)(
    'updates untouched MCP slots when replacing a %s candidate through the real menu',
    async (initialChoice) => {
      const data = discovery();
      data.mcpServers.items = [
        initialChoice === 'suggested'
          ? {
              ...mcpA,
              source: 'materialized_bundle',
              availability: 'available',
            }
          : mcpA,
        mcpB,
      ];
      const changed = vi.fn();
      render(<Harness initial={newMcp()} data={data} changed={changed} />);
      if (initialChoice === 'selected') await choose('Definition', '^a ·');
      expect(screen.getByRole('textbox', { name: 'Secret slots' })).toHaveValue(
        'TOKEN_A'
      );
      await choose('Definition', '^b ·');
      const latest = changed.mock.calls.at(
        -1
      )![0] as WorkspaceResourceEditorState;
      expect(latest).toMatchObject({
        kind: 'mcp',
        step: 'editor',
        item: {
          id: 'b',
          definition: mcpB.definition,
          secretSlots: ['TOKEN_B'],
          assignTo: [],
        },
      });
      expect(canCommitResourceEditor(latest, config)).toBe(true);
      expect(screen.getByRole('textbox', { name: 'Secret slots' })).toHaveValue(
        'TOKEN_B'
      );
    }
  );

  it.each(['CUSTOM_TOKEN', ''])(
    'preserves manually changed MCP slots (%s) when choosing another candidate',
    async (slots) => {
      const data = discovery();
      data.mcpServers.items = [mcpA, mcpB];
      const changed = vi.fn();
      render(<Harness initial={newMcp()} data={data} changed={changed} />);
      await choose('Definition', '^a ·');
      const field = screen.getByRole('textbox', { name: 'Secret slots' });
      const user = userEvent.setup();
      await user.clear(field);
      if (slots) await user.type(field, slots);
      await choose('Definition', '^b ·');
      expect(field).toHaveValue(slots);
      expect(changed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          item: {
            id: 'b',
            definition: mcpB.definition,
            secretSlots: slots ? [slots] : [],
            assignTo: [],
          },
        })
      );
    }
  );

  it('keeps pre-existing untracked slots in a new MCP draft across candidate changes', async () => {
    const data = discovery();
    data.mcpServers.items = [mcpA, mcpB];
    const changed = vi.fn();
    const initial = newMcp();
    initial.item.secretSlots = ['PRESET_TOKEN'];
    render(<Harness initial={initial} data={data} changed={changed} />);
    await choose('Definition', '^a ·');
    await choose('Definition', '^b ·');
    expect(screen.getByRole('textbox', { name: 'Secret slots' })).toHaveValue(
      'PRESET_TOKEN'
    );
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        item: {
          id: 'b',
          definition: mcpB.definition,
          secretSlots: ['PRESET_TOKEN'],
          assignTo: [],
        },
      })
    );
  });

  it.each([{ slots: [] }, { slots: ['EXTERNAL_TOKEN'] }])(
    'preserves MCP slots changed outside the field (%j) after an earlier automatic fill',
    async ({ slots }) => {
      const data = discovery();
      data.mcpServers.items = [mcpA, mcpB];
      const changed = vi.fn();
      const view = render(
        <SpaceResourceDiscoveryEditor
          editor={newMcp()}
          document={config}
          discovery={data}
          onChange={changed}
        />
      );
      await choose('Definition', '^a ·');
      const selected = changed.mock.calls.at(-1)![0] as Extract<
        Editor,
        { kind: 'mcp' }
      >;
      expect(selected.item.secretSlots).toEqual(['TOKEN_A']);
      view.rerender(
        <SpaceResourceDiscoveryEditor
          editor={{
            ...selected,
            item: { ...selected.item, secretSlots: slots },
          }}
          document={config}
          discovery={data}
          onChange={changed}
        />
      );
      await choose('Definition', '^b ·');
      expect(changed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          item: {
            id: 'b',
            definition: mcpB.definition,
            secretSlots: slots,
            assignTo: [],
          },
        })
      );
    }
  );

  it.each([{ slots: [] }, { slots: ['EXISTING_TOKEN'] }])(
    'preserves saved MCP slots %j when explicitly changing its definition',
    async ({ slots }) => {
      const data = discovery();
      const replacement = {
        ...mcpB,
        id: 'a',
        value: JSON.stringify([mcpB.definition, 'a']),
      };
      data.mcpServers.items = [mcpA, replacement];
      const changed = vi.fn();
      render(
        <Harness
          initial={{
            kind: 'mcp',
            mode: 'edit',
            step: 'editor',
            index: 0,
            item: {
              id: 'a',
              definition: mcpA.definition,
              secretSlots: slots,
              assignTo: [],
            },
          }}
          data={data}
          changed={changed}
        />
      );
      expect(changed).not.toHaveBeenCalled();
      await choose('Definition', '^b ·');
      expect(changed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          item: {
            id: 'a',
            definition: mcpB.definition,
            secretSlots: slots,
            assignTo: [],
          },
        })
      );
    }
  );

  it('shows all options in one control, retains unknown values, and offers retry', async () => {
    const retry = vi.fn(),
      onChange = vi.fn();
    const { rerender } = render(
      <SpaceDiscoveryField
        title="Skill"
        value="unknown://kept"
        onChange={onChange}
        catalog={{
          items: [skill, secondSkill],
          status: 'ready',
          error: null,
          retry,
        }}
      />
    );
    const user = userEvent.setup();
    expect(
      screen.queryByRole('button', { name: 'Browse available options' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enter manually' })).toBeNull();
    screen.getByRole('combobox').focus();
    await user.keyboard('[ArrowDown]');
    expect(screen.getByRole('option', { name: /Research/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Writer/ })).toBeVisible();
    expect(
      screen.getByRole('option', { name: 'unknown://kept' })
    ).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('[Escape]');
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      <SpaceDiscoveryField
        title="Skill"
        value="unknown://kept"
        onChange={onChange}
        catalog={{ items: [], status: 'error', error: 'failure', retry }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'Skill' })).toHaveTextContent(
      'unknown://kept'
    );
  });

  it('loads subsequent pages without a browse step and stops on an error', () => {
    const loadMore = vi.fn(),
      retry = vi.fn();
    const props = {
      title: 'Connector',
      value: '',
      onChange: vi.fn(),
      loadMore,
      hasMore: true,
      loadingMore: false,
    };
    const view = render(
      <SpaceDiscoveryField
        {...props}
        catalog={{ items: [], status: 'empty', error: null, retry }}
      />
    );
    expect(loadMore).toHaveBeenCalledOnce();
    expect(screen.getByText('Loading...')).toBeVisible();
    view.rerender(
      <SpaceDiscoveryField
        {...props}
        catalog={{
          items: [connector],
          status: 'ready',
          error: 'discovery_unavailable',
          retry,
        }}
      />
    );
    expect(loadMore).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('does not auto-select disabled resources and explains duplicate skills', async () => {
    const data = discovery(),
      changed = vi.fn();
    data.skills.items = [
      { ...skill, disabled: true, reason: 'global_resource_disabled' },
    ];
    const initial: Editor = {
      kind: 'skill',
      mode: 'create',
      step: 'picker',
      item: { ref: '', assignTo: [] },
    };
    const view = render(
      <SpaceResourceDiscoveryEditor
        editor={initial}
        document={config}
        discovery={data}
        onChange={changed}
      />
    );
    expect(changed).not.toHaveBeenCalled();
    data.skills.items = [skill, secondSkill];
    view.rerender(
      <SpaceResourceDiscoveryEditor
        editor={{ ...initial, item: { ref: 'registry://kept', assignTo: [] } }}
        document={{
          ...config,
          spec: {
            ...config.spec,
            skills: [{ ref: skill.value, assignTo: [] }],
          },
        }}
        discovery={data}
        onChange={changed}
      />
    );
    const user = userEvent.setup();
    screen.getByRole('combobox', { name: 'Skill reference' }).focus();
    await user.keyboard('[ArrowDown]');
    expect(screen.getByRole('option', { name: /Research/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('option', { name: /Research/ })).toHaveTextContent(
      'Already added to this Space'
    );
  });

  it('keeps an edited MCP ID and assignments while all configured definitions remain selectable', async () => {
    const data = discovery(),
      changed = vi.fn();
    data.mcpServers.items = [mcpA, mcpB];
    render(<Harness initial={newMcp()} data={data} changed={changed} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'MCP server id' }), {
      target: { value: 'custom-id' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Assign to agents' }),
      { target: { value: 'custom-agent' } }
    );
    await choose('Definition', '^b ·');
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        item: {
          id: 'custom-id',
          definition: mcpB.definition,
          secretSlots: ['TOKEN_B'],
          assignTo: ['custom-agent'],
        },
      })
    );
    expect(
      screen.getByRole('combobox', { name: 'Definition' })
    ).toHaveTextContent('b');
  });
});
