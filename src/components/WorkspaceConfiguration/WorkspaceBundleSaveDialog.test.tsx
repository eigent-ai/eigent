import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  preflight: vi.fn(),
  recordPublished: vi.fn(),
  buildAuthorReview: vi.fn(),
  ensureBundle: vi.fn(),
  findBundle: vi.fn(),
  getRevision: vi.fn(),
  validateRevision: vi.fn(),
  uploadAsset: vi.fn(),
  publishRevision: vi.fn(),
}));

vi.mock('@/service/workspaceConfigurationApi', async (original) => ({
  ...(await original()),
  reviewWorkspaceConfiguration: mocks.review,
  preflightWorkspaceConfigurationAsset: mocks.preflight,
  recordPublishedWorkspaceConfiguration: mocks.recordPublished,
}));

vi.mock('@/service/workspaceBundleAuthoringApi', () => ({
  buildWorkspaceBundleAuthorReview: mocks.buildAuthorReview,
  ensureWorkspaceBundle: mocks.ensureBundle,
  findWorkspaceBundle: mocks.findBundle,
  getWorkspaceBundleRevision: mocks.getRevision,
  validateWorkspaceBundleRevision: mocks.validateRevision,
  uploadWorkspaceBundleAsset: mocks.uploadAsset,
  publishWorkspaceBundleRevision: mocks.publishRevision,
}));

import type {
  WorkspaceConfigurationDraft,
  WorkspaceConfigurationSaveReview,
} from '@/service/workspaceConfigurationApi';
import { WorkspaceBundleSaveDialog } from './WorkspaceBundleSaveDialog';

const digest = 'a'.repeat(64);
const cloudDigest = 'c'.repeat(64);
const assetDigest = 'd'.repeat(64);
const draft: WorkspaceConfigurationDraft = {
  space_id: 'space-1',
  version: 1,
  base_revision_id: null,
  document_digest: digest,
  persisted: true,
  updated_at: 1,
  document: {
    apiVersion: 'eigent.ai/v1alpha1',
    kind: 'WorkforceBundle',
    metadata: { id: 'bundle-1', name: 'Research', revision: 1 },
    spec: {
      instructions: { coordinator: 'bundle://instructions/coordinator.md' },
      context: [],
      skills: [],
      connectors: [],
      mcpServers: [],
      environment: { variables: [] },
      agents: [],
      models: {
        default: {
          modelRef: 'provider://default',
          thinkingEffort: 'medium',
        },
      },
      permissions: { profile: 'request_approval', rules: [] },
      git: {
        enabled: true,
        checkpointPolicy: 'user_and_run_terminal',
        agentIsolation: 'worktree',
        remotePolicy: 'prompt',
      },
    },
  },
};

const review: WorkspaceConfigurationSaveReview = {
  bundle_id: 'bundle-1',
  revision_id: 'bundle-1@1',
  manifest_digest: digest,
  name: 'Research',
  review_digest: 'b'.repeat(64),
  summary: {
    instructions: 1,
    context_sources: 0,
    skills: 0,
    connectors: 0,
    mcp_servers: 0,
    agents: 0,
  },
  requirements: {
    environment_variables: [],
    suggested_environment_variables: [],
    suggested_mcp_secret_slots: [],
    secret_slots: [],
    connector_slots: [],
    local_path_slots: [],
  },
  assets: ['bundle://instructions/coordinator.md'],
  warnings: [],
  local_values_excluded: 0,
};

const renderDialog = (
  overrides: {
    onOpenChange?: ReturnType<typeof vi.fn>;
    onApplyRequirements?: ReturnType<typeof vi.fn>;
    onApplyMcpSecretSlots?: ReturnType<typeof vi.fn>;
    onPublished?: ReturnType<typeof vi.fn>;
  } = {}
) => {
  const props = {
    onOpenChange: overrides.onOpenChange ?? vi.fn(),
    onApplyRequirements: overrides.onApplyRequirements ?? vi.fn(),
    onApplyMcpSecretSlots: overrides.onApplyMcpSecretSlots ?? vi.fn(),
    onPublished: overrides.onPublished ?? vi.fn(),
  };
  render(
    <WorkspaceBundleSaveDialog
      open
      spaceId="space-1"
      identity={{ email: 'user@example.com', userId: 42 }}
      draft={draft}
      {...props}
    />
  );
  return props;
};

const selectAsset = (file: File) => {
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
};

describe('WorkspaceBundleSaveDialog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.review.mockResolvedValue({ draft_version: 1, review });
    mocks.findBundle.mockResolvedValue(null);
    mocks.preflight.mockImplementation(
      async (_spaceId, _identity, logicalPath, file: File) => ({
        logical_path: logicalPath.replace(/^bundle:\/\//, ''),
        content_digest: assetDigest,
        size_bytes: file.size,
      })
    );
    mocks.buildAuthorReview.mockResolvedValue({
      presented_review_digest: review.review_digest,
      review_digest: 'e'.repeat(64),
      manifest_digest: digest,
      visibility: 'private',
      selected_assets: [
        {
          logical_path: 'instructions/coordinator.md',
          content_digest: assetDigest,
        },
      ],
    });
    mocks.ensureBundle.mockResolvedValue({
      id: 'bundle-1',
      latest_published_revision_id: null,
    });
    mocks.validateRevision.mockResolvedValue({
      id: 'bundle-1@1',
      manifest_digest: digest,
      status: 'validated',
      assets: [],
    });
    mocks.uploadAsset.mockResolvedValue({
      logical_path: 'instructions/coordinator.md',
      content_digest: assetDigest,
      size_bytes: 17,
    });
    mocks.publishRevision.mockResolvedValue({
      id: 'bundle-1@1',
      manifest_digest: digest,
      status: 'published',
    });
    mocks.recordPublished.mockResolvedValue({});
  });

  it('preflights every selected asset before the first Cloud mutation and refreshes only after closing success', async () => {
    const onPublished = vi.fn();
    renderDialog({ onPublished });
    await screen.findByText('Values stay on this device');

    const file = new File(['safe instructions'], 'coordinator.md', {
      type: 'text/markdown',
    });
    selectAsset(file);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Published');
    expect(mocks.preflight).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 42 },
      'bundle://instructions/coordinator.md',
      file
    );
    expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureBundle.mock.invocationCallOrder[0]
    );
    expect(mocks.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalPath: 'bundle://instructions/coordinator.md',
        file,
      })
    );
    expect(onPublished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it('does not make a Cloud mutation when local asset preflight fails', async () => {
    mocks.preflight.mockRejectedValue(
      new Error('Secret-bearing field found in config.json')
    );
    renderDialog();
    await screen.findByText('Values stay on this device');
    selectAsset(
      new File(['{"api_key":"low-entropy-real-secret"}'], 'config.json')
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Secret-bearing field found in config.json');
    expect(mocks.ensureBundle).not.toHaveBeenCalled();
    expect(mocks.validateRevision).not.toHaveBeenCalled();
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    expect(mocks.publishRevision).not.toHaveBeenCalled();
  });

  it('cannot be dismissed by close, overlay, or Escape while publishing', async () => {
    let finishPreflight: ((value: unknown) => void) | undefined;
    mocks.preflight.mockReturnValue(
      new Promise((resolve) => {
        finishPreflight = resolve;
      })
    );
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    await screen.findByText('Values stay on this device');
    const file = new File(['safe instructions'], 'coordinator.md');
    selectAsset(file);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByRole('button', { name: 'Publishing…' });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(
      document.querySelector('.bg-dialog-overlay-scrim') as Element
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    finishPreflight?.({
      logical_path: 'instructions/coordinator.md',
      content_digest: assetDigest,
      size_bytes: file.size,
    });
    await screen.findByText('Published');
  });

  it('removes a previous selection and review when an oversized replacement is chosen', async () => {
    renderDialog();
    await screen.findByText('Values stay on this device');
    selectAsset(new File(['safe'], 'coordinator.md'));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeEnabled();

    const oversized = new File(['x'], 'oversized.md');
    Object.defineProperty(oversized, 'size', { value: 16 * 1024 * 1024 + 1 });
    selectAsset(oversized);

    expect(await screen.findByText(/exceeds the 16 MiB/)).toBeInTheDocument();
    expect(screen.getByText('Choose a local file')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    ).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeDisabled();
  });

  it('resets explicit review when visibility changes', async () => {
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: { ...review, assets: [] },
    });
    renderDialog();
    await screen.findByText('Values stay on this device');
    const confirmation = screen.getByRole('switch', {
      name: 'Confirm secret-free review',
    });
    fireEvent.click(confirmation);
    expect(confirmation).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^public/ }));
    expect(confirmation).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeDisabled();
  });

  it('recovers a Cloud-published version without selecting assets and rebases newer local edits', async () => {
    const onPublished = vi.fn();
    mocks.findBundle.mockResolvedValue({
      id: 'bundle-1',
      workspace_id: 'space-1',
      name: 'Research',
      visibility: 'public',
      latest_published_revision_id: 'bundle-1@1',
    });
    mocks.getRevision.mockResolvedValue({
      id: 'bundle-1@1',
      bundle_id: 'bundle-1',
      revision: 1,
      manifest: draft.document,
      manifest_digest: cloudDigest,
      status: 'published',
      assets: [],
    });
    renderDialog({ onPublished });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Finish saving locally' })
    );

    await screen.findByText('Published');
    expect(mocks.recordPublished).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 42 },
      expect.objectContaining({ manifestDigest: cloudDigest })
    );
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(mocks.ensureBundle).not.toHaveBeenCalled();
    expect(mocks.validateRevision).not.toHaveBeenCalled();
    expect(
      screen.getByText(/newer local edits continue in the next version/)
    ).toBeInTheDocument();
    expect(onPublished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it('converges when Cloud publish wins after review loading with a different local digest', async () => {
    mocks.ensureBundle.mockResolvedValue({
      id: 'bundle-1',
      latest_published_revision_id: 'bundle-1@1',
    });
    mocks.getRevision.mockResolvedValue({
      id: 'bundle-1@1',
      bundle_id: 'bundle-1',
      revision: 1,
      manifest: draft.document,
      manifest_digest: cloudDigest,
      status: 'published',
      assets: [],
    });
    renderDialog();
    await screen.findByText('Values stay on this device');
    selectAsset(new File(['safe instructions'], 'coordinator.md'));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Published');
    expect(mocks.preflight).toHaveBeenCalledTimes(1);
    expect(mocks.recordPublished).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 42 },
      expect.objectContaining({ manifestDigest: cloudDigest })
    );
    expect(mocks.validateRevision).not.toHaveBeenCalled();
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    expect(
      screen.getByText(/newer local edits continue in the next version/)
    ).toBeInTheDocument();
  });

  it('writes discovered environment and MCP secret requirements back before publishing', async () => {
    const onApplyRequirements = vi.fn();
    const onApplyMcpSecretSlots = vi.fn();
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: {
        ...review,
        assets: [],
        requirements: {
          ...review.requirements,
          suggested_environment_variables: [
            { name: 'API_TOKEN', required: true, sensitive: true },
          ],
          suggested_mcp_secret_slots: [
            { mcp_id: 'github', secret_slots: ['mcp.github.env.GITHUB_TOKEN'] },
          ],
        },
      },
    });
    renderDialog({ onApplyRequirements, onApplyMcpSecretSlots });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Add safe requirements to configuration',
      })
    );

    await waitFor(() => {
      expect(onApplyRequirements).toHaveBeenCalled();
      expect(onApplyMcpSecretSlots).toHaveBeenCalledWith([
        { mcp_id: 'github', secret_slots: ['mcp.github.env.GITHUB_TOKEN'] },
      ]);
    });
    expect(mocks.ensureBundle).not.toHaveBeenCalled();
  });
});
