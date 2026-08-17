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
  fetchReview: vi.fn(),
  fetchProposal: vi.fn(),
  createProposal: vi.fn(),
  decide: vi.fn(),
  bindValues: vi.fn(),
  bindPath: vi.fn(),
  bindConnector: vi.fn(),
  approveScript: vi.fn(),
  materialize: vi.fn(),
  digest: vi.fn(),
  fetchConnected: vi.fn(),
  secretPut: vi.fn(),
  secretDelete: vi.fn(),
  selectFile: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
  ensureScratch: vi.fn(),
  setActiveSpace: vi.fn(),
  setActiveProject: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock('@/service/workspaceBundleInstallApi', () => ({
  parseWorkspaceBundleHandle: (value: string) => {
    const match =
      /^@([a-z0-9][a-z0-9._-]{0,79})\/([a-z0-9][a-z0-9._-]{0,79})@([1-9][0-9]*)$/.exec(
        value
      );
    return match
      ? {
          publisherNamespace: match[1],
          slug: match[2],
          version: Number(match[3]),
          coordinate: value,
        }
      : null;
  },
  fetchWorkspaceBundleInstallReview: mocks.fetchReview,
  fetchWorkspaceBundleInstallProposal: mocks.fetchProposal,
  createWorkspaceBundleInstallProposal: mocks.createProposal,
  decideWorkspaceBundleInstall: mocks.decide,
  bindWorkspaceBundleLocalValues: mocks.bindValues,
  bindWorkspaceBundleLocalPath: mocks.bindPath,
  bindWorkspaceBundleConnector: mocks.bindConnector,
  approveWorkspaceBundleScript: mocks.approveScript,
  materializeWorkspaceBundle: mocks.materialize,
  workspaceBundleAccountScopeDigest: mocks.digest,
}));

vi.mock('@/api/connectors', () => ({
  fetchConnectedProviders: mocks.fetchConnected,
  providerLabel: (provider: { service: string }) => provider.service,
}));

vi.mock('@/host', () => ({
  useHost: () => ({
    electronAPI: {
      workspaceSecretPut: mocks.secretPut,
      workspaceSecretDelete: mocks.secretDelete,
      selectFile: mocks.selectFile,
    },
  }),
}));

vi.mock('@/lib/scratchSpaceWorkspace', () => ({
  ensureScratchSpaceWorkspaceBinding: mocks.ensureScratch,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({ email: 'owner@example.com', user_id: 'user-1' }),
}));

vi.mock('@/store/spaceStore', () => {
  const state = {
    spaces: {} as Record<string, Record<string, unknown>>,
    projectsBySpaceId: {} as Record<string, Record<string, unknown>>,
    createSpaceOnServer: mocks.createSpace,
    updateSpaceOnServer: mocks.updateSpace,
    deleteSpaceOnServer: mocks.deleteSpace,
    setActiveSpace: mocks.setActiveSpace,
    getSpaceById: (spaceId: string) =>
      state.spaces[spaceId] ?? {
        id: spaceId,
        name: 'Imported',
        sourceType: 'blank',
      },
  };
  const useSpaceStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return {
    isDisposableBlankSpace: (space: Record<string, unknown> | null) =>
      Boolean(
        space &&
        space.name === 'Untitled Space' &&
        space.sourceType === 'blank' &&
        (space.metadata as { autoCreatedPlaceholder?: boolean } | undefined)
          ?.autoCreatedPlaceholder === true
      ),
    useSpaceStore,
  };
});
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => ({ setActiveProject: mocks.setActiveProject }),
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: object) => unknown) =>
    selector({ setActiveWorkspaceTab: mocks.setActiveWorkspaceTab }),
}));
vi.mock('@/store/settingsStore', () => ({
  openSettings: mocks.openSettings,
}));

import { WorkspaceBundleInstallWizard } from '@/components/WorkspaceBundle/WorkspaceBundleInstallWizard';
import type { WorkspaceBundleInstallSnapshot } from '@/service/workspaceBundleInstallApi';
import { useSpaceStore } from '@/store/spaceStore';

const manifest = {
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: { id: 'research', name: 'Research workspace', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    connectors: [],
    mcpServers: [],
    environment: {
      variables: [
        {
          name: 'API_TOKEN',
          required: true,
          sensitive: true,
          description: 'Research API token',
        },
      ],
    },
    agents: [],
    models: {
      default: { modelRef: 'provider://default', thinkingEffort: 'medium' },
    },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: true,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'prompt',
    },
  },
} as const;

const review = {
  bundle: {
    id: 'wb_11111111111111111111111111111111',
    workspace_id: 'author-space',
    publisher_type: 'user' as const,
    publisher_id: '7',
    publisher_namespace: 'verified-publisher',
    slug: 'research',
    package_name: '@verified-publisher/research',
    name: 'Research workspace',
    visibility: 'public' as const,
    latest_published_revision_id: 'wbr_11111111111111111111111111111111',
  },
  revision: {
    id: 'wbr_11111111111111111111111111111111',
    bundle_id: 'wb_11111111111111111111111111111111',
    revision: 1,
    publisher_namespace: 'verified-publisher',
    slug: 'research',
    package_name: '@verified-publisher/research',
    version: 1,
    coordinate: '@verified-publisher/research@1',
    manifest,
    manifest_digest: 'a'.repeat(64),
    status: 'published' as const,
    assets: [],
  },
};

const snapshot = (
  configured = false,
  runtimeReadiness?: WorkspaceBundleInstallSnapshot['runtime_readiness'],
  runtimeReadinessIssues: string[] = []
): WorkspaceBundleInstallSnapshot => ({
  proposal: {
    proposal_id: 'proposal-1',
    request_id: 'request-1',
    space_id: 'space-1',
    bundle_id: 'research',
    revision_id: 'research@1',
    config_placement: 'sidecar',
    state: 'approved',
    version: configured ? 3 : 2,
    manifest:
      manifest as WorkspaceBundleInstallSnapshot['proposal']['manifest'],
    manifest_digest: 'a'.repeat(64),
    assets: [],
    install_plan: {
      connector_slots: [],
      local_path_slots: [],
      script_actions: [],
      environment_requirements: [],
      mcp_secret_requirements: [],
      permission_profile: 'request_approval',
      git_policy: {},
      asset_count: 0,
      asset_bytes: 0,
    },
  },
  bindings: [],
  value_requirements: [
    {
      requirement_key: 'environment:API_TOKEN',
      requirement_kind: 'environment',
      name: 'API_TOKEN',
      required: true,
      sensitive: true,
      configured,
      available: configured,
      binding_version: configured ? 1 : null,
    },
  ],
  readiness: {
    ready: configured,
    missing_requirements: configured ? [] : ['environment:API_TOKEN'],
  },
  ...(runtimeReadiness
    ? {
        runtime_readiness: runtimeReadiness,
        runtime_readiness_issues: runtimeReadinessIssues,
      }
    : {}),
});

function renderWizard(props: {
  initialHandle?: string;
  initialProposalId?: string;
  targetSpaceId?: string;
  showHeader?: boolean;
}) {
  return render(
    <MemoryRouter>
      <WorkspaceBundleInstallWizard {...props} />
    </MemoryRouter>
  );
}

describe('WorkspaceBundleInstallWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.fetchConnected.mockResolvedValue([]);
    mocks.digest.mockResolvedValue('b'.repeat(64));
    mocks.createSpace.mockResolvedValue('space-1');
    mocks.ensureScratch.mockResolvedValue('/tmp/space-1');
    mocks.createProposal.mockResolvedValue({
      ...snapshot(false),
      proposal: { ...snapshot(false).proposal, state: 'proposed', version: 1 },
    });
    mocks.decide.mockResolvedValue(snapshot(false));
    const spaceStore = useSpaceStore.getState();
    spaceStore.spaces = {};
    spaceStore.projectsBySpaceId = {};
  });

  it('renders without standalone page navigation', () => {
    renderWizard({});

    expect(
      screen.queryByRole('button', { name: 'Back to Spaces' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Install Workspace Bundle' })
    ).toBeInTheDocument();
  });

  it('removes the share-handle card border and padding when embedded', () => {
    renderWizard({ showHeader: false });

    const title = screen.getByText('Import by share handle');
    const cardHeader = title.parentElement;
    const card = cardHeader?.parentElement;
    const input = screen.getByRole('textbox', {
      name: 'Workspace Bundle share handle',
    });

    expect(card).toHaveClass('space-y-3', '!border-0');
    expect(cardHeader).toHaveClass('!p-0');
    expect(input.closest('form')?.parentElement).toHaveClass('!p-0');
  });

  it('resumes an in-progress embedded import without a page URL', async () => {
    window.localStorage.setItem(
      'eigent:workspace-bundle-active-install:v1:user-1',
      JSON.stringify({
        proposalId: 'proposal-1',
        handle: '@verified-publisher/research@1',
      })
    );
    mocks.fetchProposal.mockResolvedValue(snapshot(false));

    renderWizard({});

    await waitFor(() =>
      expect(mocks.fetchProposal).toHaveBeenCalledWith('proposal-1')
    );
    expect(await screen.findByText('1. Local values')).toBeInTheDocument();
  });

  it('restores a reviewed handle before a proposal exists', async () => {
    mocks.fetchReview.mockResolvedValue(review);
    const first = renderWizard({
      initialHandle: '@verified-publisher/research@1',
    });
    expect(await screen.findByText('Research workspace')).toBeInTheDocument();
    first.unmount();
    mocks.fetchReview.mockClear();

    renderWizard({});

    await waitFor(() =>
      expect(mocks.fetchReview).toHaveBeenCalledWith({
        publisherNamespace: 'verified-publisher',
        slug: 'research',
        version: 1,
        coordinate: '@verified-publisher/research@1',
      })
    );
    expect(await screen.findByText('Research workspace')).toBeInTheDocument();
  });

  it('opens the Connectors settings section for a missing connection', async () => {
    const pendingConnection = snapshot(false);
    pendingConnection.proposal.install_plan.connector_slots = [
      {
        slot_id: 'research-connector',
        connector_id: 'github',
        required_grants: [],
      },
    ];
    mocks.fetchProposal.mockResolvedValue(pendingConnection);
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    await user.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(mocks.openSettings).toHaveBeenCalledWith('connectors');
  });

  it('requires a separate approval after persisting the install proposal', async () => {
    mocks.fetchReview.mockResolvedValue(review);
    const user = userEvent.setup();
    renderWizard({ initialHandle: '@verified-publisher/research@1' });

    expect(await screen.findByText('Research workspace')).toBeInTheDocument();
    expect(mocks.createSpace).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: /confirm and create/i })
    );

    expect(
      await screen.findByRole('button', { name: /approve installation/i })
    ).toBeInTheDocument();
    expect(mocks.createSpace).toHaveBeenCalledTimes(1);
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        publisherNamespace: 'verified-publisher',
        slug: 'research',
        version: 1,
      })
    );
    expect(mocks.decide).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: /approve installation/i })
    );

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
  });

  it('installs into the selected placeholder Space instead of creating another Space', async () => {
    const placeholder = {
      id: 'empty-space',
      name: 'Untitled Space',
      sourceType: 'blank',
      status: 'active',
      metadata: {
        createdFrom: 'initial_hydrate',
        autoCreatedPlaceholder: true,
      },
    };
    const spaceStore = useSpaceStore.getState();
    spaceStore.spaces = { 'empty-space': placeholder };
    spaceStore.projectsBySpaceId = { 'empty-space': {} };
    mocks.fetchReview.mockResolvedValue(review);
    const user = userEvent.setup();
    renderWizard({
      initialHandle: '@verified-publisher/research@1',
      targetSpaceId: 'empty-space',
    });

    await user.click(
      await screen.findByRole('button', { name: /confirm and create/i })
    );

    await waitFor(() => expect(mocks.createProposal).toHaveBeenCalledTimes(1));
    expect(mocks.createSpace).not.toHaveBeenCalled();
    expect(mocks.updateSpace).toHaveBeenCalledWith(
      'empty-space',
      expect.objectContaining({ name: 'Research workspace' })
    );
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'empty-space' })
    );
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
  });

  it('stores plaintext only through the Electron vault and binds an opaque ref', async () => {
    mocks.fetchProposal.mockResolvedValue(snapshot(false));
    mocks.secretPut.mockResolvedValue({
      secret_ref: `wsvault_${'A'.repeat(32)}`,
      account_scope_digest: 'b'.repeat(64),
      space_id: 'space-1',
      revision_id: 'research@1',
      slot_id: 'environment:API_TOKEN',
      state: 'available',
    });
    mocks.bindValues.mockResolvedValue(snapshot(true));
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    const input = await screen.findByLabelText('Local value for API_TOKEN');
    await user.type(input, 'plaintext-do-not-send-to-brain');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.bindValues).toHaveBeenCalledTimes(1));
    expect(mocks.secretPut).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'plaintext-do-not-send-to-brain' })
    );
    expect(JSON.stringify(mocks.bindValues.mock.calls[0][0])).not.toContain(
      'plaintext-do-not-send-to-brain'
    );
    expect(mocks.bindValues).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: [
          expect.objectContaining({ secret_ref: `wsvault_${'A'.repeat(32)}` }),
        ],
      })
    );
  });

  it('removes a newly stored secret when the durable binding is rejected', async () => {
    mocks.fetchProposal.mockResolvedValue(snapshot(false));
    mocks.secretPut.mockResolvedValue({
      secret_ref: `wsvault_${'C'.repeat(32)}`,
      account_scope_digest: 'b'.repeat(64),
      space_id: 'space-1',
      revision_id: 'research@1',
      slot_id: 'environment:API_TOKEN',
      state: 'available',
    });
    mocks.bindValues.mockRejectedValue(new Error('Version conflict'));
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    await user.type(
      await screen.findByLabelText('Local value for API_TOKEN'),
      'orphan-candidate'
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.secretDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          secret_ref: `wsvault_${'C'.repeat(32)}`,
          slot_id: 'environment:API_TOKEN',
        })
      )
    );
  });

  it('repairs an unavailable local value with the safe binding version', async () => {
    const unavailable = snapshot(false);
    unavailable.value_requirements[0] = {
      ...unavailable.value_requirements[0],
      configured: true,
      available: false,
      binding_version: 4,
    };
    mocks.fetchProposal.mockResolvedValue(unavailable);
    mocks.secretPut.mockResolvedValue({
      secret_ref: `wsvault_${'B'.repeat(32)}`,
      account_scope_digest: 'b'.repeat(64),
      space_id: 'space-1',
      revision_id: 'research@1',
      slot_id: 'environment:API_TOKEN',
      state: 'available',
    });
    mocks.bindValues.mockResolvedValue({
      ...snapshot(true),
      cleanup_secret_refs: [`wsvault_${'A'.repeat(32)}`],
    });
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    expect(
      await screen.findByText(/previous local value is unavailable/i)
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Local value for API_TOKEN'),
      'replacement-value'
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.bindValues).toHaveBeenCalledWith(
        expect.objectContaining({
          bindings: [expect.objectContaining({ expected_binding_version: 4 })],
        })
      )
    );
    expect(mocks.secretDelete).toHaveBeenCalledWith(
      expect.objectContaining({ secret_ref: `wsvault_${'A'.repeat(32)}` })
    );
  });

  it('keeps local setup editable after the Workspace is installed', async () => {
    const installed = snapshot(true);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
    };
    mocks.fetchProposal.mockResolvedValue(installed);
    mocks.secretPut.mockResolvedValue({
      secret_ref: `wsvault_${'C'.repeat(32)}`,
      account_scope_digest: 'b'.repeat(64),
      space_id: 'space-1',
      revision_id: 'research@1',
      slot_id: 'environment:API_TOKEN',
      state: 'available',
    });
    mocks.bindValues.mockResolvedValue({
      ...installed,
      proposal: { ...installed.proposal, version: 9 },
    });
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    expect(
      await screen.findByText('Workspace files installed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/runtime ready/i)).toBeNull();
    expect(screen.getByText('Runtime check unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/is installed\. Local bindings are encrypted/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/All declared local bindings are currently available/i)
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchConnected).toHaveBeenCalledTimes(1));
    await user.type(
      screen.getByLabelText('Local value for API_TOKEN'),
      'rotated-value'
    );
    await user.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() =>
      expect(mocks.bindValues).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 8,
          bindings: [expect.objectContaining({ expected_binding_version: 1 })],
        })
      )
    );
  });

  it('shows Runtime ready only after a successful Brain runtime preflight', async () => {
    const installed = snapshot(true, 'ready');
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
    };
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(await screen.findByText('Runtime ready')).toBeInTheDocument();
    expect(screen.getByText(/Brain preflight confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText('Runtime check unavailable')).toBeNull();
  });

  it('keeps MCP target confirmation separate from installed files', async () => {
    const installed = snapshot(true, 'needs_confirmation', [
      'mcp_destination_confirmation_required',
    ]);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
    };
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(
      await screen.findByText('Workspace files installed')
    ).toBeInTheDocument();
    expect(screen.getByText('MCP target review required')).toBeInTheDocument();
    expect(
      screen.getByText(/review and approve each supported MCP destination/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One or more MCP servers require explicit destination review.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('mcp_destination_confirmation_required')
    ).toBeNull();
    expect(screen.queryByText('Runtime ready')).toBeNull();
  });

  it('shows exact MCP destination details and approves by action identity only', async () => {
    const definitionDigest = 'c'.repeat(64);
    const attestationDigest = 'd'.repeat(64);
    const logLevelDigest = 'e'.repeat(64);
    const mcpModeDigest = 'f'.repeat(64);
    const clientVersionDigest = '1'.repeat(64);
    const actionId = 'mcp.server.start:bundle-local';
    const destination = {
      mcp_id: 'bundle-local',
      definition_ref: 'bundle://mcp/bundle-local',
      definition_digest: definitionDigest,
      destination_kind: 'stdio',
      executable_command: 'node',
      argument_preview: ['server.js', '--mode=readonly'],
      endpoint_url: null,
      cwd_scope: 'workspace://project',
      public_environment: [
        { name: 'LOG_LEVEL', value_digest: logLevelDigest },
        { name: 'MCP_MODE', value_digest: mcpModeDigest },
      ],
      public_headers: [
        {
          name: 'X-Client-Version',
          value_digest: clientVersionDigest,
        },
      ],
      secret_slots: ['github-token'],
      secret_environment_bindings: [
        {
          slot_id: 'github-token',
          environment_variable: 'GITHUB_TOKEN',
        },
      ],
      attestation_digest: attestationDigest,
      requires_secret_confirmation: true,
    };
    const installed = snapshot(true, 'needs_confirmation', [
      'mcp_destination_confirmation_required',
    ]);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
      install_plan: {
        ...installed.proposal.install_plan,
        script_actions: [actionId],
        mcp_destinations: [destination],
      },
    };
    installed.value_requirements.push({
      requirement_key: 'mcp_secret:bundle-local:github-token',
      requirement_kind: 'mcp_secret',
      configured: true,
      available: true,
      binding_version: 1,
      required: true,
      mcp_id: 'bundle-local',
      slot_id: 'github-token',
    });
    const approved = snapshot(true, 'unavailable', [
      'mcp_secret_stdio_runtime_adapter_unavailable:bundle-local',
    ]);
    approved.proposal = {
      ...approved.proposal,
      state: 'materialized',
      version: 9,
      install_plan: {
        ...approved.proposal.install_plan,
        script_actions: [actionId],
        mcp_destinations: [destination],
      },
    };
    approved.bindings = [
      {
        slot_id: actionId,
        binding_kind: 'script_approval',
        required_grants: [],
        current: true,
      },
    ];
    mocks.fetchProposal.mockResolvedValue(installed);
    mocks.approveScript.mockResolvedValue(approved);
    const user = userEvent.setup();

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(await screen.findByText('bundle-local')).toBeInTheDocument();
    expect(screen.getByText('node')).toBeInTheDocument();
    expect(screen.getByText('server.js')).toBeInTheDocument();
    expect(screen.getByText('--mode=readonly')).toBeInTheDocument();
    expect(screen.getByText('workspace://project')).toBeInTheDocument();
    expect(screen.getByText('bundle://mcp/bundle-local')).toBeInTheDocument();
    expect(
      screen.getByText(`SHA-256: ${definitionDigest}`)
    ).toBeInTheDocument();
    expect(screen.getByText(attestationDigest)).toBeInTheDocument();
    expect(screen.getAllByText('github-token')).toHaveLength(2);
    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    const publicEnvironment = screen.getByRole('region', {
      name: 'Public environment for bundle-local',
    });
    expect(publicEnvironment).toHaveClass('max-h-32', 'overflow-y-auto');
    expect(screen.getByText('LOG_LEVEL')).toBeInTheDocument();
    expect(screen.getByText(`SHA-256 ${logLevelDigest}`)).toBeInTheDocument();
    expect(screen.getByText('MCP_MODE')).toBeInTheDocument();
    expect(screen.getByText(`SHA-256 ${mcpModeDigest}`)).toBeInTheDocument();
    const publicHeaders = screen.getByRole('region', {
      name: 'Public headers for bundle-local',
    });
    expect(publicHeaders).toHaveClass('max-h-32', 'overflow-y-auto');
    expect(screen.getByText('X-Client-Version')).toBeInTheDocument();
    expect(
      screen.getByText(`SHA-256 ${clientVersionDigest}`)
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Approve bundle-local MCP destination',
      })
    );

    await waitFor(() => expect(mocks.approveScript).toHaveBeenCalledTimes(1));
    const approvalRequest = mocks.approveScript.mock.calls[0][0];
    expect(approvalRequest).toEqual({
      proposalId: 'proposal-1',
      expectedVersion: 8,
      actionId,
      actorId: 'user-1',
    });
    expect(JSON.stringify(approvalRequest)).not.toContain(definitionDigest);
    expect(JSON.stringify(approvalRequest)).not.toContain(attestationDigest);
    expect(JSON.stringify(approvalRequest)).not.toContain('github-token');
    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This Desktop version cannot yet safely start this approved secret-backed MCP server.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByText('Runtime ready')).toBeNull();
  });

  it('requires every MCP secret to be locally available before approval', async () => {
    const actionId = 'mcp.server.start:bundle-local';
    const installed = snapshot(true, 'needs_confirmation', [
      'mcp_destination_confirmation_required',
    ]);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
      install_plan: {
        ...installed.proposal.install_plan,
        script_actions: [actionId],
        mcp_destinations: [
          {
            mcp_id: 'bundle-local',
            definition_ref: 'bundle://mcp/bundle-local',
            definition_digest: 'c'.repeat(64),
            destination_kind: 'stdio',
            executable_command: 'node',
            argument_preview: ['server.js'],
            endpoint_url: null,
            cwd_scope: 'workspace://project',
            public_environment: [],
            public_headers: [],
            secret_slots: ['github-token'],
            secret_environment_bindings: [
              {
                slot_id: 'github-token',
                environment_variable: 'GITHUB_TOKEN',
              },
            ],
            attestation_digest: 'd'.repeat(64),
            requires_secret_confirmation: true,
          },
        ],
      },
    };
    installed.value_requirements.push({
      requirement_key: 'mcp_secret:bundle-local:github-token',
      requirement_kind: 'mcp_secret',
      configured: true,
      available: false,
      binding_version: 1,
      required: true,
      mcp_id: 'bundle-local',
      slot_id: 'github-token',
    });
    installed.bindings = [
      {
        slot_id: actionId,
        binding_kind: 'script_approval',
        required_grants: [],
        current: false,
      },
    ];
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    const approve = await screen.findByRole('button', {
      name: 'Approve bundle-local MCP destination',
    });
    expect(approve).toBeDisabled();
    expect(
      screen.getByText(/add the required local secrets before approving/i)
    ).toHaveTextContent('github-token');
    expect(screen.queryByText('Approved')).toBeNull();
  });

  it('does not offer approval for unsupported secret-backed HTTP MCP destinations', async () => {
    const installed = snapshot(true, 'unavailable', [
      'mcp_destination_confirmation_required',
    ]);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
      install_plan: {
        ...installed.proposal.install_plan,
        mcp_destinations: [
          {
            mcp_id: 'remote-mcp',
            definition_ref: 'bundle://mcp/remote-mcp',
            definition_digest: 'e'.repeat(64),
            destination_kind: 'http_secret_unavailable',
            executable_command: null,
            argument_preview: [],
            endpoint_url: 'https://mcp.example.test/events',
            cwd_scope: null,
            public_environment: [],
            public_headers: [],
            secret_slots: ['authorization'],
            secret_environment_bindings: [],
            attestation_digest: null,
            requires_secret_confirmation: true,
          },
        ],
      },
    };
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(
      await screen.findByText('https://mcp.example.test/events')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /secret-backed HTTP or header MCP destinations are not supported/i
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Approve remote-mcp MCP destination',
      })
    ).toBeNull();
  });

  it('maps every reported Brain issue code to user-readable copy', async () => {
    const issues = [
      'connector_runtime_adapter_unavailable',
      'multi_agent_runtime_adapter_unavailable',
      'registry_dependencies_unmaterialized',
      'workspace_bundle_not_materialized',
      'local_setup_incomplete',
    ];
    const installed = snapshot(true, 'unavailable', issues);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
    };
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(await screen.findByText('Runtime unavailable')).toBeInTheDocument();
    for (const message of [
      'A required connector cannot run in this Desktop version.',
      'This Bundle requires multi-agent runtime support that is not available.',
      'A registry dependency has not been downloaded and pinned locally yet.',
      'Workspace files and configuration have not finished installing.',
      'Required local values, folders, connections, or approvals are incomplete.',
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    for (const issue of issues) {
      expect(screen.queryByText(issue)).toBeNull();
    }
    expect(screen.queryByText('Runtime ready')).toBeNull();
  });

  it('does not expose an unknown Brain issue code as user-facing copy', async () => {
    const unknownIssue = 'future_adapter_error:private/runtime/detail';
    const installed = snapshot(true, 'unavailable', [unknownIssue]);
    installed.proposal = {
      ...installed.proposal,
      state: 'materialized',
      version: 8,
    };
    mocks.fetchProposal.mockResolvedValue(installed);

    renderWizard({ initialProposalId: 'proposal-1' });

    expect(
      await screen.findByText(
        'An additional runtime requirement needs attention.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(unknownIssue)).toBeNull();
  });

  it('reconciles the durable binding after an ambiguous response loss', async () => {
    mocks.fetchProposal
      .mockResolvedValueOnce(snapshot(false))
      .mockResolvedValueOnce(snapshot(true));
    mocks.secretPut.mockResolvedValue({
      secret_ref: `wsvault_${'D'.repeat(32)}`,
      account_scope_digest: 'b'.repeat(64),
      space_id: 'space-1',
      revision_id: 'research@1',
      slot_id: 'environment:API_TOKEN',
      state: 'available',
    });
    mocks.bindValues.mockRejectedValue(
      new Error('Response lost after the durable commit')
    );
    const user = userEvent.setup();
    renderWizard({ initialProposalId: 'proposal-1' });

    await user.type(
      await screen.findByLabelText('Local value for API_TOKEN'),
      'possibly-committed-value'
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Response lost after the durable commit')
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchProposal).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
  });

  it('offers a retry when the read-only review request fails', async () => {
    mocks.fetchReview
      .mockRejectedValueOnce(new Error('Cloud is temporarily unavailable'))
      .mockResolvedValueOnce(review);
    const user = userEvent.setup();
    renderWizard({ initialHandle: '@verified-publisher/research@1' });

    expect(
      await screen.findByText('Cloud is temporarily unavailable')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Research workspace')).toBeInTheDocument();
    expect(mocks.fetchReview).toHaveBeenCalledTimes(2);
  });

  it('retries a proposal failure without creating a second Space', async () => {
    mocks.fetchReview.mockResolvedValue(review);
    mocks.createProposal
      .mockRejectedValueOnce(new Error('Brain response was interrupted'))
      .mockResolvedValueOnce({
        ...snapshot(false),
        proposal: {
          ...snapshot(false).proposal,
          state: 'proposed',
          version: 1,
        },
      });
    const user = userEvent.setup();
    renderWizard({ initialHandle: '@verified-publisher/research@1' });

    await user.click(
      await screen.findByRole('button', { name: /confirm and create/i })
    );
    expect(
      await screen.findByText('Brain response was interrupted')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await user.click(
      await screen.findByRole('button', { name: 'Approve installation' })
    );
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.createProposal).toHaveBeenCalledTimes(2);
    expect(mocks.createSpace).toHaveBeenCalledTimes(1);
  });

  it('recovers the inactive Space seed after a renderer restart', async () => {
    mocks.fetchReview.mockResolvedValue(review);
    mocks.createProposal.mockRejectedValueOnce(
      new Error('Brain stopped before the proposal commit')
    );
    const user = userEvent.setup();
    const first = renderWizard({
      initialHandle: '@verified-publisher/research@1',
    });

    await user.click(
      await screen.findByRole('button', { name: /confirm and create/i })
    );
    expect(
      await screen.findByText('Brain stopped before the proposal commit')
    ).toBeInTheDocument();
    first.unmount();

    mocks.createProposal.mockResolvedValueOnce({
      ...snapshot(false),
      proposal: { ...snapshot(false).proposal, state: 'proposed', version: 1 },
    });
    renderWizard({ initialHandle: '@verified-publisher/research@1' });
    await user.click(
      await screen.findByRole('button', { name: /confirm and create/i })
    );

    await user.click(
      await screen.findByRole('button', { name: 'Approve installation' })
    );
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.createSpace).toHaveBeenCalledTimes(1);
    expect(mocks.createProposal).toHaveBeenCalledTimes(2);
  });
});
