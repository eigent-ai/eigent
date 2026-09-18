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
import type { WorkspaceResourceEditorState } from '@/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel';
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
  await user.click(
    screen.getByRole('button', { name: 'Browse available options' })
  );
  screen.getByRole('combobox', { name: `Select ${title}` }).focus();
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
      screen.getByRole('textbox', { name: 'Skill reference' })
    ).toHaveValue(skill.value);
    expect(screen.getByText(/Review this editable draft/)).toBeVisible();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ item: { ref: skill.value, assignTo: [] } })
    );
    expect(config.spec.git.enabled).toBe(false);
    expect(config.spec.models.default.modelRef).toBe('provider://default');
  });

  it('never fills an existing resource or refills a value the user cleared before discovery returned', () => {
    const data = discovery();
    data.skills.items = [];
    data.skills.status = 'loading';
    const changed = vi.fn();
    const view = render(
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
    const field = screen.getByRole('textbox', { name: 'Skill reference' });
    fireEvent.change(field, { target: { value: 'manual' } });
    fireEvent.change(field, { target: { value: '' } });
    data.skills = { ...data.skills, status: 'ready', items: [skill] };
    view.rerender(
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
    expect(field).toHaveValue('');
    expect(changed).toHaveBeenCalledTimes(2);
    view.unmount();
    changed.mockClear();
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
      screen.getByRole('textbox', { name: 'Skill reference' })
    ).toHaveValue('registry://legacy@1');
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

  it('filters long candidate labels, preserves unknown manual values, and shows retry/empty states', async () => {
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
    await user.click(
      screen.getByRole('button', { name: 'Browse available options' })
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Search Skill' }),
      'Research'
    );
    screen.getByRole('combobox').focus();
    await user.keyboard('[ArrowDown]');
    expect(screen.getByRole('option', { name: /Research/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /Writer/ })).toBeNull();
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
    expect(screen.getByRole('textbox', { name: 'Skill' })).toHaveValue(
      'unknown://kept'
    );
  });
});
