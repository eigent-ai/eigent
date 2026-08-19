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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectSource: vi.fn(),
  inspect: vi.fn(),
  convert: vi.fn(),
  setActiveSpace: vi.fn(),
  setActiveProject: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  fetchWorkspaceConfiguration: vi.fn(),
  createSpaceOnServer: vi.fn(),
  deleteSpaceOnServer: vi.fn(),
  ensureScratchSpaceWorkspaceBinding: vi.fn(),
}));

vi.mock('@/host', () => ({
  useHost: () => ({
    electronAPI: { selectAgentPluginSource: mocks.selectSource },
  }),
}));

vi.mock('@/service/agentPluginImportApi', () => ({
  inspectAgentPluginSource: mocks.inspect,
  convertAgentPluginToWorkspaceBundleDraft: mocks.convert,
}));

vi.mock('@/service/workspaceConfigurationApi', () => ({
  fetchWorkspaceConfiguration: mocks.fetchWorkspaceConfiguration,
}));

vi.mock('@/lib/scratchSpaceWorkspace', () => ({
  ensureScratchSpaceWorkspaceBinding: mocks.ensureScratchSpaceWorkspaceBinding,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (value: object) => unknown) =>
    selector({ email: 'owner@example.com', user_id: 'user-1' }),
}));

vi.mock('@/store/spaceStore', () => {
  const state = {
    spaces: {
      'space-1': {
        id: 'space-1',
        name: 'Research Workspace',
        status: 'active',
      },
      'space-2': {
        id: 'space-2',
        name: 'Writing Workspace',
        status: 'active',
      },
    },
    projectsBySpaceId: {},
    activeSpaceId: 'space-1',
    setActiveSpace: mocks.setActiveSpace,
    createSpaceOnServer: mocks.createSpaceOnServer,
    deleteSpaceOnServer: mocks.deleteSpaceOnServer,
  };
  const useSpaceStore = (selector: (value: typeof state) => unknown) =>
    selector(state);
  useSpaceStore.getState = () => ({
    ...state,
    getSpaceById: (spaceId: string) =>
      Object.values(state.spaces).find((space) => space.id === spaceId) ??
      (spaceId === 'plugin-space'
        ? {
            id: 'plugin-space',
            name: 'Research Agent Plugin',
            status: 'active',
          }
        : undefined),
  });
  return {
    isUnconfiguredPlaceholderSpace: () => false,
    useSpaceStore,
  };
});

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (value: object) => unknown) =>
    selector({ setActiveProject: mocks.setActiveProject }),
}));

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (value: object) => unknown) =>
    selector({ setActiveWorkspaceTab: mocks.setActiveWorkspaceTab }),
}));

import { AgentPluginImportWizard } from '@/components/WorkspaceBundle/AgentPluginImportWizard';
import type { AgentPluginInspection } from '@/service/agentPluginImportApi';

const REVIEW_DIGEST = 'a'.repeat(64);

const inspection: AgentPluginInspection = {
  standard: 'agent-plugins',
  schema_version: '1.0.0',
  source_tree_digest: 'sha256:tree',
  converted_tree_digest: 'sha256:converted-tree',
  metadata: {
    name: 'Research Agent Plugin',
    version: '1.2.0',
    description: 'Research workflows',
    author: { name: 'Example', url: 'https://example.invalid' },
  },
  source: { display_name: 'research-plugin.zip', source_kind: 'archive' },
  skills: [
    { id: 'skill-1', name: 'Source review', description: 'Review sources' },
  ],
  skipped_skills: [
    {
      id: 'unsupported-skill',
      name: 'Unsupported Skill',
      reason_code: 'unsupported_feature',
      reason: 'This optional feature cannot be converted.',
    },
  ],
  mcp_servers: [
    {
      id: 'search',
      name: 'Search MCP',
      transport: 'stdio',
      command: 'node',
      args: ['server.js', '--mode', 'safe'],
      command_summary: 'node server.js',
      cwd: 'servers/search',
      url: null,
      env_names: ['SEARCH_TOKEN'],
      header_names: ['X-Search-Key'],
      public_environment: [
        {
          name: 'LOG_LEVEL',
          value: 'debug',
          value_digest: 'b'.repeat(64),
          truncated: false,
        },
      ],
      public_headers: [],
      credential_requirement_keys: ['SEARCH_TOKEN'],
    },
  ],
  skipped_mcp_servers: [
    {
      id: 'unsupported-mcp',
      reason_code: 'unsupported_transport',
      reason: 'The declared transport is not supported.',
    },
  ],
  files: [
    {
      logical_path: 'skills/source-review/SKILL.md',
      content_digest: 'sha256:abc123',
      size_bytes: 512,
    },
  ],
  credential_requirements: [
    {
      requirement_key: 'SEARCH_TOKEN',
      label: 'Search token',
      description: 'Configure after conversion',
      requirement_kind: 'mcp_secret',
      required: true,
      sensitive: true,
      // A defensive renderer test: even if a future response accidentally
      // adds a value field, this review component must never render it.
      value: 'never-show-this-secret',
    } as AgentPluginInspection['credential_requirements'][number],
  ],
  warnings: [
    {
      code: 'script_review_required',
      severity: 'warning',
      message: 'Review the declared command before use.',
    },
  ],
  diagnostics: [
    {
      code: 'unsupported_optional_field',
      severity: 'info',
      message: 'An optional extension will be retained as metadata.',
      logical_path: 'plugin.json',
    },
  ],
  review_digest: REVIEW_DIGEST,
  convertible: true,
};

const renderWizard = (
  props: {
    initialTargetSpaceId?: string | null;
    showHeader?: boolean;
    onConfigurationOpen?: () => void;
    targetMode?: 'existing' | 'create-space';
  } = {}
) =>
  render(
    <MemoryRouter>
      <AgentPluginImportWizard {...props} />
    </MemoryRouter>
  );

describe('AgentPluginImportWizard', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.selectSource.mockResolvedValue({
      canceled: false,
      source_path: '/Users/person/private/research-plugin.zip',
      display_name: 'research-plugin.zip',
      source_kind: 'archive',
    });
    mocks.inspect.mockResolvedValue(inspection);
    mocks.convert.mockResolvedValue({
      slug: 'research-plugin',
      version: 1,
      target_space_id: 'space-1',
      status: 'draft',
    });
    mocks.fetchWorkspaceConfiguration.mockResolvedValue({
      version: 0,
      persisted: false,
      base_revision_id: null,
    });
    mocks.createSpaceOnServer.mockResolvedValue('plugin-space');
    mocks.deleteSpaceOnServer.mockResolvedValue(undefined);
    mocks.ensureScratchSpaceWorkspaceBinding.mockResolvedValue(
      '/workspace/plugin-space'
    );
  });

  it('removes standalone navigation, card border and padding when embedded', () => {
    renderWizard({ showHeader: false, initialTargetSpaceId: 'space-1' });

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Import Agent Plugin' })
    ).toBeNull();
    const title = screen.getByText('Select an Agent Plugin');
    const cardHeader = title.parentElement;
    const card = cardHeader?.parentElement;
    const selectButton = screen.getByRole('button', {
      name: 'Select directory or archive',
    });

    expect(card).toHaveClass('space-y-3', '!border-0');
    expect(cardHeader).toHaveClass('!p-0');
    expect(selectButton.parentElement).toHaveClass('!p-0');
  });

  it('reviews standard metadata, Skills, MCP servers, files, requirements and warnings without exposing source paths or values', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(
      screen.queryByRole('button', { name: /convert to local draft/i })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );

    expect(await screen.findByText('Research Agent Plugin')).toBeVisible();
    expect(screen.getByText('Source review')).toBeVisible();
    expect(screen.getByText('Search MCP')).toBeVisible();
    expect(screen.getByText(/Environment names: SEARCH_TOKEN/)).toBeVisible();
    expect(screen.getByText(/Header names: X-Search-Key/)).toBeVisible();
    expect(screen.getByText(/argv\[0\]: server.js/)).toBeVisible();
    expect(screen.getByText(/env LOG_LEVEL = debug/)).toBeVisible();
    expect(screen.getByText(/Skipped: Unsupported Skill/)).toBeVisible();
    expect(screen.getByText(/Skipped: unsupported-mcp/)).toBeVisible();
    expect(screen.getByText('skills/source-review/SKILL.md')).toBeVisible();
    expect(screen.getByText('Search token')).toBeVisible();
    expect(
      screen.getByText('Review the declared command before use.')
    ).toBeVisible();
    expect(screen.getByText('Review diagnostics')).toBeVisible();
    expect(screen.getByText('unsupported_optional_field')).toBeVisible();
    expect(screen.queryByText(/\/Users\/person\/private/)).toBeNull();
    expect(screen.queryByText('never-show-this-secret')).toBeNull();
    expect(mocks.inspect).toHaveBeenCalledWith({
      sourcePath: '/Users/person/private/research-plugin.zip',
      email: 'owner@example.com',
      userId: 'user-1',
    });
  });

  it('does not surface a selected absolute path from a local inspection error', async () => {
    const user = userEvent.setup();
    mocks.inspect.mockRejectedValueOnce(
      new Error(
        'Invalid plugin at /Users/person/private/research-plugin.zip/plugin.json'
      )
    );
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );

    expect(await screen.findByText(/Invalid plugin/)).toHaveTextContent(
      'the selected Agent Plugin/plugin.json'
    );
    expect(screen.queryByText(/\/Users\/person\/private/)).toBeNull();
  });

  it('requires explicit review confirmation and binds conversion to the reviewed digest', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await screen.findByText('Research Agent Plugin');

    const convertButton = screen.getByRole('button', {
      name: /convert to local draft/i,
    });
    expect(convertButton).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: /confirm agent plugin review/i })
    );
    expect(convertButton).toBeEnabled();
    await user.click(convertButton);

    await waitFor(() =>
      expect(mocks.convert).toHaveBeenCalledWith({
        sourcePath: '/Users/person/private/research-plugin.zip',
        expectedReviewDigest: REVIEW_DIGEST,
        targetSpaceId: 'space-1',
        expectedTargetDraftVersion: 0,
        clientRequestId: expect.stringMatching(/^agentplugin_/),
        updatedBy: 'user-1',
        email: 'owner@example.com',
        userId: 'user-1',
      })
    );
    expect(await screen.findByText('Agent Plugin converted')).toBeVisible();
    expect(
      screen.getByText(/has not been published or installed/i)
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: /review workspace draft/i })
    );
    expect(mocks.setActiveSpace).toHaveBeenCalledWith('space-1');
    expect(mocks.setActiveProject).toHaveBeenCalledWith(null);
    expect(mocks.setActiveWorkspaceTab).toHaveBeenCalledWith('workforce');
  });

  it('creates a named Space only after confirming an Agent Plugin conversion', async () => {
    const user = userEvent.setup();
    mocks.convert.mockResolvedValueOnce({
      slug: 'research-plugin',
      version: 1,
      target_space_id: 'plugin-space',
      status: 'draft',
    });
    renderWizard({ targetMode: 'create-space', showHeader: false });

    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    const spaceName = await screen.findByRole('textbox', {
      name: 'New Space name',
    });
    expect(spaceName).toHaveValue('Research Agent Plugin');
    expect(mocks.createSpaceOnServer).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('checkbox', { name: /confirm agent plugin review/i })
    );
    await user.click(
      screen.getByRole('button', { name: /convert to local draft/i })
    );

    await waitFor(() =>
      expect(mocks.createSpaceOnServer).toHaveBeenCalledWith({
        name: 'Research Agent Plugin',
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'agent_plugin_import',
          autoCreatedPlaceholder: false,
        },
      })
    );
    expect(mocks.ensureScratchSpaceWorkspaceBinding).toHaveBeenCalledWith({
      email: 'owner@example.com',
      userId: 'user-1',
      space: expect.objectContaining({ id: 'plugin-space' }),
    });
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledWith(
      'plugin-space',
      { email: 'owner@example.com', userId: 'user-1' }
    );
    await waitFor(() =>
      expect(mocks.convert).toHaveBeenCalledWith(
        expect.objectContaining({ targetSpaceId: 'plugin-space' })
      )
    );
  });

  it('retries a lost conversion response with the same request id and pinned target version', async () => {
    const user = userEvent.setup();
    mocks.convert
      .mockRejectedValueOnce(new Error('The local response was lost.'))
      .mockResolvedValueOnce({
        slug: 'research-plugin',
        version: 2,
        target_space_id: 'space-1',
        status: 'draft',
      });
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: /confirm agent plugin review/i,
      })
    );
    const convertButton = screen.getByRole('button', {
      name: /convert to local draft/i,
    });
    await user.click(convertButton);

    expect(await screen.findByText(/local response was lost/i)).toBeVisible();
    expect(convertButton).toBeEnabled();
    await user.click(convertButton);
    expect(await screen.findByText('Agent Plugin converted')).toBeVisible();
    expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(mocks.convert.mock.calls[1][0].clientRequestId).toBe(
      mocks.convert.mock.calls[0][0].clientRequestId
    );
    expect(mocks.convert.mock.calls[1][0].expectedTargetDraftVersion).toBe(
      mocks.convert.mock.calls[0][0].expectedTargetDraftVersion
    );
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(1);
  });

  it('refreshes target state and requires a new request after a definitive draft conflict', async () => {
    const user = userEvent.setup();
    mocks.fetchWorkspaceConfiguration
      .mockResolvedValueOnce({
        version: 2,
        persisted: false,
        base_revision_id: null,
      })
      .mockResolvedValueOnce({
        version: 3,
        persisted: false,
        base_revision_id: null,
      });
    mocks.convert
      .mockRejectedValueOnce(
        Object.assign(new Error('Workspace configuration changed.'), {
          status: 409,
          response: {
            data: {
              detail: { code: 'workspace_configuration_changed' },
            },
          },
        })
      )
      .mockResolvedValueOnce({
        slug: 'research-plugin',
        version: 3,
        target_space_id: 'space-1',
        status: 'draft',
      });
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: /confirm agent plugin review/i,
      })
    );
    const convertButton = screen.getByRole('button', {
      name: /convert to local draft/i,
    });
    await user.click(convertButton);

    expect(
      await screen.findByText(/workspace configuration changed/i)
    ).toBeVisible();
    await user.click(convertButton);

    expect(await screen.findByText('Agent Plugin converted')).toBeVisible();
    expect(mocks.fetchWorkspaceConfiguration).toHaveBeenCalledTimes(2);
    expect(mocks.convert.mock.calls[1][0].expectedTargetDraftVersion).toBe(3);
    expect(mocks.convert.mock.calls[1][0].clientRequestId).not.toBe(
      mocks.convert.mock.calls[0][0].clientRequestId
    );
  });

  it('requires a second explicit confirmation before replacing an existing Workspace draft', async () => {
    const user = userEvent.setup();
    mocks.fetchWorkspaceConfiguration.mockResolvedValueOnce({
      version: 7,
      persisted: true,
      base_revision_id: 'bundle@example@6',
      document: { metadata: { name: 'Existing Research Workspace' } },
    });
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: /confirm agent plugin review/i,
      })
    );
    const convertButton = screen.getByRole('button', {
      name: /convert to local draft/i,
    });
    await user.click(convertButton);

    expect(
      await screen.findByText(/replace the existing workspace draft/i)
    ).toBeVisible();
    expect(screen.getByText(/does not merge configurations/i)).toBeVisible();
    expect(mocks.convert).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('checkbox', {
        name: /confirm replacing existing workspace draft/i,
      })
    );
    await user.click(convertButton);
    await waitFor(() => expect(mocks.convert).toHaveBeenCalledTimes(1));
    expect(mocks.convert.mock.calls[0][0].expectedTargetDraftVersion).toBe(7);
  });

  it('locks the target selector while target preflight is pending', async () => {
    const user = userEvent.setup();
    let resolveTarget:
      | ((value: {
          version: number;
          persisted: boolean;
          base_revision_id: null;
        }) => void)
      | undefined;
    mocks.fetchWorkspaceConfiguration.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTarget = resolve;
        })
    );
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: /confirm agent plugin review/i,
      })
    );
    await user.click(
      screen.getByRole('button', { name: /convert to local draft/i })
    );

    const target = screen.getByRole('combobox', { name: /target workspace/i });
    expect(target).toBeDisabled();
    resolveTarget?.({
      version: 0,
      persisted: false,
      base_revision_id: null,
    });
    expect(await screen.findByText('Agent Plugin converted')).toBeVisible();
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(mocks.convert.mock.calls[0][0].targetSpaceId).toBe('space-1');
  });

  it('submits only one conversion while a double click is in flight', async () => {
    const user = userEvent.setup();
    let resolveConversion:
      | ((value: {
          slug: string;
          version: number;
          target_space_id: string;
          status: 'draft';
        }) => void)
      | undefined;
    mocks.convert.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConversion = resolve;
        })
    );
    renderWizard();
    await user.click(
      screen.getByRole('button', { name: /select directory or archive/i })
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: /confirm agent plugin review/i,
      })
    );
    const convertButton = screen.getByRole('button', {
      name: /convert to local draft/i,
    });
    await user.dblClick(convertButton);

    await waitFor(() => expect(mocks.convert).toHaveBeenCalledTimes(1));
    resolveConversion?.({
      slug: 'research-plugin',
      version: 1,
      target_space_id: 'space-1',
      status: 'draft',
    });
    expect(await screen.findByText('Agent Plugin converted')).toBeVisible();
  });

  it('opens only one native picker while selection is in flight', async () => {
    const user = userEvent.setup();
    let resolvePicker: ((value: { canceled: true }) => void) | undefined;
    mocks.selectSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePicker = resolve;
        })
    );
    renderWizard();
    const pickerButton = screen.getByRole('button', {
      name: /select directory or archive/i,
    });
    await user.dblClick(pickerButton);

    expect(mocks.selectSource).toHaveBeenCalledTimes(1);
    resolvePicker?.({ canceled: true });
    await waitFor(() => expect(pickerButton).toBeEnabled());
  });
});
