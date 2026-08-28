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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  preflight: vi.fn(),
  preflightPrepared: vi.fn(),
  uploadPrepared: vi.fn(),
  recordPublished: vi.fn(),
  buildAuthorReview: vi.fn(),
  ensureBundle: vi.fn(),
  findBundle: vi.fn(),
  getRevision: vi.fn(),
  validateRevision: vi.fn(),
  uploadAsset: vi.fn(),
  publishRevision: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock('@/service/workspaceConfigurationApi', async (original) => ({
  ...(await original()),
  reviewWorkspaceConfiguration: mocks.review,
  preflightWorkspaceConfigurationAsset: mocks.preflight,
  preflightPreparedWorkspaceConfigurationAssets: mocks.preflightPrepared,
  uploadPreparedWorkspaceConfigurationAsset: mocks.uploadPrepared,
  recordPublishedWorkspaceConfiguration: mocks.recordPublished,
}));

vi.mock('@/service/workspaceBundleAuthoringApi', () => ({
  buildWorkspaceBundleAuthorReview: mocks.buildAuthorReview,
  ensureWorkspaceBundle: mocks.ensureBundle,
  findWorkspaceBundle: mocks.findBundle,
  findWorkspaceBundleBySlug: mocks.findBundle,
  getWorkspaceBundleRevision: mocks.getRevision,
  validateWorkspaceBundleRevision: mocks.validateRevision,
  uploadWorkspaceBundleAsset: mocks.uploadAsset,
  publishWorkspaceBundleRevision: mocks.publishRevision,
}));

import { WorkspaceBundleSaveDialog } from '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog';
import type {
  WorkspaceConfigurationDraft,
  WorkspaceConfigurationSaveReview,
} from '@/service/workspaceConfigurationApi';

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
    kind: 'WorkspaceBundle',
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
  slug: 'bundle-1',
  version: 1,
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
  prepared_assets: [],
  warnings: [],
  local_values_excluded: 0,
};

const renderDialog = (
  overrides: {
    onOpenChange?: ReturnType<typeof vi.fn>;
    onApplyRequirements?: ReturnType<typeof vi.fn>;
    onApplyMcpSecretSlots?: ReturnType<typeof vi.fn>;
    onPublished?: ReturnType<typeof vi.fn>;
    draft?: WorkspaceConfigurationDraft;
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
      draft={overrides.draft ?? draft}
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.copyText },
    });
    mocks.review.mockResolvedValue({ draft_version: 1, review });
    mocks.findBundle.mockResolvedValue(null);
    mocks.preflight.mockImplementation(
      async (_spaceId, _identity, logicalPath, file: File) => ({
        logical_path: logicalPath.replace(/^bundle:\/\//, ''),
        content_digest: assetDigest,
        size_bytes: file.size,
      })
    );
    mocks.preflightPrepared.mockResolvedValue({
      space_id: 'space-1',
      draft_version: 1,
      manifest_digest: digest,
      review_digest: review.review_digest,
      assets: [],
    });
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
      id: 'wb_11111111111111111111111111111111',
      package_name: '@user-42/bundle-1',
      latest_published_revision_id: null,
    });
    mocks.validateRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      revision: 1,
      manifest_digest: digest,
      status: 'validated',
      assets: [],
    });
    mocks.uploadAsset.mockResolvedValue({
      id: 'asset-manual',
      logical_path: 'instructions/coordinator.md',
      content_digest: assetDigest,
      media_type: 'text/markdown',
      size_bytes: 17,
      provenance: 'bundle_author',
      executable: false,
    });
    mocks.uploadPrepared.mockResolvedValue({
      asset: {
        id: 'asset-prepared',
        logical_path: 'agent-plugins/demo/plugin.json',
        content_digest: 'f'.repeat(64),
        media_type: 'application/json',
        size_bytes: 21,
        provenance: 'agent_plugin_import',
        executable: false,
      },
    });
    mocks.publishRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      revision: 1,
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

  it('offers only private and public publishing without team authority', async () => {
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: { ...review, assets: [] },
    });
    renderDialog();

    expect(
      await screen.findByRole('button', { name: /^private/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^public/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^team/i })).toBeNull();
  });

  it('rejects an existing team-scoped Bundle when team authority is unavailable', async () => {
    mocks.findBundle.mockResolvedValue({
      id: 'wb_11111111111111111111111111111111',
      workspace_id: 'space-1',
      slug: 'bundle-1',
      package_name: '@user-42/bundle-1',
      name: 'Research',
      visibility: 'team',
      latest_published_revision_id: null,
    });
    renderDialog();

    expect(
      await screen.findByText(/team sharing is not available/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeDisabled();
    expect(mocks.ensureBundle).not.toHaveBeenCalled();
  });

  it('shows and copies the exact immutable install handle after publishing', async () => {
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: { ...review, assets: [] },
    });
    renderDialog();
    await screen.findByText('Values stay on this device');
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    expect(
      await screen.findByLabelText('Published Workspace Bundle handle')
    ).toHaveTextContent('@user-42/bundle-1@1');
    expect(screen.getByText('Shareable install handle')).toBeInTheDocument();
    expect(
      screen.getByText(/paste it into Import Workspace Bundle/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy share handle' }));
    await waitFor(() =>
      expect(mocks.copyText).toHaveBeenCalledWith('@user-42/bundle-1@1')
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
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

  it('publishes prepared-only Agent Plugin assets without exposing file bytes to renderer', async () => {
    const preparedAssets = [
      {
        logical_path: 'bundle://agent-plugins/demo/plugin.json',
        content_digest: 'f'.repeat(64),
        media_type: 'application/json',
        size_bytes: 21,
        provenance: 'agent_plugin_import' as const,
        executable: false,
      },
      {
        logical_path: 'bundle://agent-plugins/demo/bin/server',
        content_digest: '9'.repeat(64),
        media_type: 'application/octet-stream',
        size_bytes: 37,
        provenance: 'agent_plugin_import' as const,
        executable: true,
      },
    ];
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: {
        ...review,
        assets: ['bundle://agent-plugins/demo/plugin.json'],
        prepared_assets: preparedAssets,
      },
    });
    mocks.preflightPrepared.mockResolvedValue({
      space_id: 'space-1',
      draft_version: 1,
      manifest_digest: digest,
      review_digest: review.review_digest,
      assets: preparedAssets,
    });
    mocks.uploadPrepared
      .mockResolvedValueOnce({
        asset: {
          id: 'asset-plugin',
          ...preparedAssets[0],
          logical_path: 'agent-plugins/demo/plugin.json',
        },
      })
      .mockResolvedValueOnce({
        asset: {
          id: 'asset-server',
          ...preparedAssets[1],
          logical_path: 'agent-plugins/demo/bin/server',
        },
      });

    renderDialog();
    await screen.findByText('Imported Agent Plugin package files (2)');

    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(
      screen.getByText('agent-plugins/demo/bin/server')
    ).toBeInTheDocument();
    expect(screen.getByText(/executable/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm imported package upload' })
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Published');
    expect(mocks.preflightPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureBundle.mock.invocationCallOrder[0]
    );
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.uploadPrepared).toHaveBeenCalledTimes(2);
    expect(mocks.uploadPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.uploadPrepared.mock.invocationCallOrder[1]
    );
    for (const call of mocks.uploadPrepared.mock.calls) {
      const request = call[2];
      expect(request).not.toHaveProperty('file');
      expect(request).not.toHaveProperty('content');
      expect(JSON.stringify(request)).not.toContain('File');
    }
    expect(mocks.buildAuthorReview).toHaveBeenCalledWith({
      presentedReviewDigest: review.review_digest,
      manifestDigest: digest,
      visibility: 'private',
      selectedAssets: [
        {
          logical_path: 'agent-plugins/demo/plugin.json',
          content_digest: 'f'.repeat(64),
          media_type: 'application/json',
          size_bytes: 21,
          provenance: 'agent_plugin_import',
          executable: false,
        },
        {
          logical_path: 'agent-plugins/demo/bin/server',
          content_digest: '9'.repeat(64),
          media_type: 'application/octet-stream',
          size_bytes: 37,
          provenance: 'agent_plugin_import',
          executable: true,
        },
      ],
    });
  });

  it('requires file selection only for manual assets in a mixed review', async () => {
    const preparedAsset = {
      logical_path: 'bundle://agent-plugins/demo/plugin.json',
      content_digest: 'f'.repeat(64),
      media_type: 'application/json',
      size_bytes: 21,
      provenance: 'agent_plugin_import' as const,
      executable: false,
    };
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: {
        ...review,
        assets: [
          'bundle://instructions/coordinator.md',
          preparedAsset.logical_path,
        ],
        prepared_assets: [preparedAsset],
      },
    });
    mocks.preflightPrepared.mockResolvedValue({
      space_id: 'space-1',
      draft_version: 1,
      manifest_digest: digest,
      review_digest: review.review_digest,
      assets: [preparedAsset],
    });

    renderDialog();
    await screen.findByText('Imported Agent Plugin package files (1)');

    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(screen.getByText('instructions/coordinator.md')).toBeInTheDocument();
    expect(screen.getAllByText('agent-plugins/demo/plugin.json')).toHaveLength(
      1
    );

    selectAsset(
      new File(['safe instructions'], 'coordinator.md', {
        type: 'text/markdown',
      })
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm imported package upload' })
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Published');
    expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureBundle.mock.invocationCallOrder[0]
    );
    expect(mocks.preflightPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureBundle.mock.invocationCallOrder[0]
    );
    expect(mocks.uploadAsset.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.uploadPrepared.mock.invocationCallOrder[0]
    );
    expect(mocks.buildAuthorReview).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedAssets: [
          expect.objectContaining({
            logical_path: 'instructions/coordinator.md',
            provenance: 'bundle_author',
            executable: false,
          }),
          expect.objectContaining({
            logical_path: 'agent-plugins/demo/plugin.json',
            provenance: 'agent_plugin_import',
            executable: false,
          }),
        ],
      })
    );
  });

  it('keeps prepared confirmation after a transient Cloud failure for an idempotent retry', async () => {
    const preparedAsset = {
      logical_path: 'bundle://agent-plugins/demo/plugin.json',
      content_digest: 'f'.repeat(64),
      media_type: 'application/json',
      size_bytes: 21,
      provenance: 'agent_plugin_import' as const,
      executable: false,
    };
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: {
        ...review,
        assets: [preparedAsset.logical_path],
        prepared_assets: [preparedAsset],
      },
    });
    mocks.preflightPrepared.mockResolvedValue({
      space_id: 'space-1',
      draft_version: 1,
      manifest_digest: digest,
      review_digest: review.review_digest,
      assets: [preparedAsset],
    });
    mocks.uploadPrepared.mockRejectedValueOnce(
      new Error('Cloud temporarily unavailable')
    );

    renderDialog();
    await screen.findByText('Imported Agent Plugin package files (1)');
    const preparedConfirmation = screen.getByRole('switch', {
      name: 'Confirm imported package upload',
    });
    fireEvent.click(preparedConfirmation);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Cloud temporarily unavailable');
    expect(preparedConfirmation).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Confirm secret-free review' })
    ).toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Publish version' })
    ).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    await screen.findByText('Published');
    expect(mocks.uploadPrepared).toHaveBeenCalledTimes(2);
  });

  it('resets prepared upload confirmation when sharing visibility changes', async () => {
    const preparedAsset = {
      logical_path: 'bundle://agent-plugins/demo/plugin.json',
      content_digest: 'f'.repeat(64),
      media_type: 'application/json',
      size_bytes: 21,
      provenance: 'agent_plugin_import' as const,
      executable: false,
    };
    mocks.review.mockResolvedValue({
      draft_version: 1,
      review: {
        ...review,
        assets: [preparedAsset.logical_path],
        prepared_assets: [preparedAsset],
      },
    });

    renderDialog();
    await screen.findByText('Imported Agent Plugin package files (1)');
    const preparedConfirmation = screen.getByRole('switch', {
      name: 'Confirm imported package upload',
    });
    fireEvent.click(preparedConfirmation);
    expect(preparedConfirmation).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /^public/ }));
    expect(preparedConfirmation).not.toBeChecked();
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
    const editedDraft: WorkspaceConfigurationDraft = {
      ...draft,
      version: 2,
      document_digest: digest,
      document: {
        ...draft.document,
        metadata: {
          ...draft.document.metadata,
          name: 'Edited after Cloud publish',
        },
      },
    };
    const preparedAsset = {
      logical_path: 'bundle://agent-plugins/demo/plugin.json',
      content_digest: 'f'.repeat(64),
      media_type: 'application/json',
      size_bytes: 21,
      provenance: 'agent_plugin_import' as const,
      executable: false,
    };
    mocks.review.mockResolvedValue({
      draft_version: editedDraft.version,
      review: {
        ...review,
        name: editedDraft.document.metadata.name,
        assets: ['bundle://agent-plugins/demo/plugin.json'],
        prepared_assets: [preparedAsset],
      },
    });
    mocks.findBundle.mockResolvedValue({
      id: 'wb_11111111111111111111111111111111',
      workspace_id: 'space-1',
      slug: 'bundle-1',
      package_name: '@user-42/bundle-1',
      name: 'Research',
      visibility: 'public',
      latest_published_revision_id: 'wbr_11111111111111111111111111111111',
    });
    mocks.getRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      bundle_id: 'wb_11111111111111111111111111111111',
      revision: 1,
      manifest: draft.document,
      manifest_digest: cloudDigest,
      status: 'published',
      assets: [
        {
          id: 'asset-prepared',
          ...preparedAsset,
          logical_path: 'agent-plugins/demo/plugin.json',
        },
      ],
    });
    renderDialog({ onPublished, draft: editedDraft });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Finish saving locally' })
    );

    await screen.findByText('Published');
    expect(mocks.recordPublished).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 42 },
      expect.objectContaining({
        expectedVersion: editedDraft.version,
        manifestDigest: cloudDigest,
      })
    );
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.preflightPrepared).not.toHaveBeenCalled();
    expect(mocks.uploadPrepared).not.toHaveBeenCalled();
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
      id: 'wb_11111111111111111111111111111111',
      package_name: '@user-42/bundle-1',
      latest_published_revision_id: 'wbr_11111111111111111111111111111111',
    });
    mocks.getRevision.mockResolvedValue({
      id: 'wbr_11111111111111111111111111111111',
      bundle_id: 'wb_11111111111111111111111111111111',
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
