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

import {
  BlockedWorkspaceOperationCard,
  BlockedWorkspaceOperationNotice,
} from '@/components/ChatBox/BlockedWorkspaceOperationCard';
import {
  checkpointBlockedWorkspaceOperation,
  dismissBlockedWorkspaceOperation,
  fetchWorkspaceGitStatus,
  type WorkspaceBlockedOperation,
} from '@/service/workspaceGitApi';
import { toast } from 'sonner';

vi.mock('@/service/workspaceGitApi', () => ({
  fetchWorkspaceGitStatus: vi.fn(),
  checkpointBlockedWorkspaceOperation: vi.fn(),
  dismissBlockedWorkspaceOperation: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const localSpace = {
  id: 'space-1',
  name: 'Local Space',
  sourceType: 'folder',
  rootPath: '/tmp/space-1',
  status: 'active',
  metadata: {},
  createdAt: 1,
  updatedAt: 1,
} as any;

const blocked: WorkspaceBlockedOperation = {
  intent_id: `gitintent_${'1'.repeat(32)}`,
  run_id: 'run-1',
  project_id: 'project-1',
  status: 'needs_attention',
  scope: 'exact_path',
  relative_path: 'notes.md',
  trigger: 'filesystem.edit',
  created_at: 1,
  updated_at: 2,
  actionable: true,
  can_checkpoint: true,
  repo_state_digest: 'c'.repeat(64),
};

const statusWith = (operations: WorkspaceBlockedOperation[]) =>
  ({
    space_id: 'space-1',
    enabled: true,
    blocked_operations: operations,
  }) as any;

describe('BlockedWorkspaceOperationCard', () => {
  it('explains the block and offers both ways out', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <BlockedWorkspaceOperationCard
        operation={blocked}
        action={null}
        onSave={onSave}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('Blocked workspace operation')).toBeInTheDocument();
    expect(screen.getByText(/change to notes\.md unfinished/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save as checkpoint' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss (files untouched)' })
    );
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('waits for a running Task and offers only Dismiss when saving is unsupported', () => {
    render(
      <BlockedWorkspaceOperationCard
        operation={{
          ...blocked,
          scope: 'broad_process',
          relative_path: null,
          actionable: false,
          can_checkpoint: false,
        }}
        moreCount={2}
        action={null}
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(
      screen.getByText('Stop the running task to resolve this.')
    ).toBeInTheDocument();
    expect(screen.getByText('+2 more blocked')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save as checkpoint' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Dismiss (files untouched)' })
    ).toBeDisabled();
  });

  it('locks both actions while one is in flight', () => {
    render(
      <BlockedWorkspaceOperationCard
        operation={blocked}
        action="saving"
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Dismiss (files untouched)' })
    ).toBeDisabled();
  });
});

describe('BlockedWorkspaceOperationNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays hidden for in-flight work of a running Task', async () => {
    vi.mocked(fetchWorkspaceGitStatus).mockResolvedValue(
      statusWith([{ ...blocked, status: 'prepared', actionable: false }])
    );

    const { container } = render(
      <BlockedWorkspaceOperationNotice
        space={localSpace}
        email="user@example.com"
        userId="user-1"
      />
    );

    await waitFor(() => expect(fetchWorkspaceGitStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('saves the reviewed state and refreshes the Space status', async () => {
    vi.mocked(fetchWorkspaceGitStatus)
      .mockResolvedValueOnce(statusWith([blocked]))
      .mockResolvedValue(statusWith([]));
    vi.mocked(checkpointBlockedWorkspaceOperation).mockResolvedValue({
      intent_id: blocked.intent_id,
      status: 'completed',
      commit_oids: ['a'.repeat(40)],
    });

    render(
      <BlockedWorkspaceOperationNotice
        space={localSpace}
        email="user@example.com"
        userId="user-1"
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save as checkpoint' })
    );

    await waitFor(() =>
      expect(screen.queryByText('Blocked workspace operation')).toBeNull()
    );
    expect(checkpointBlockedWorkspaceOperation).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 'user-1' },
      expect.objectContaining({
        intentId: blocked.intent_id,
        expectedRepoStateDigest: blocked.repo_state_digest,
      })
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('dismisses through the API and explains a failed resolution', async () => {
    vi.mocked(fetchWorkspaceGitStatus).mockResolvedValue(statusWith([blocked]));
    vi.mocked(dismissBlockedWorkspaceOperation).mockRejectedValue(
      Object.assign(new Error('changed'), {
        response: { data: { detail: { code: 'repo_state_changed' } } },
      })
    );

    render(
      <BlockedWorkspaceOperationNotice
        space={localSpace}
        email="user@example.com"
        userId="user-1"
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Dismiss (files untouched)' })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'The workspace changed. Review it and try again.'
      )
    );
    expect(dismissBlockedWorkspaceOperation).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 'user-1' },
      blocked.intent_id
    );
    expect(checkpointBlockedWorkspaceOperation).not.toHaveBeenCalled();
  });

  it('does not query Spaces without a local folder', async () => {
    render(
      <BlockedWorkspaceOperationNotice
        space={{ ...localSpace, sourceType: 'blank', rootPath: undefined }}
        email="user@example.com"
        userId="user-1"
      />
    );

    await Promise.resolve();
    expect(fetchWorkspaceGitStatus).not.toHaveBeenCalled();
  });
});
