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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';
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

// jsdom has no layout, so resolve the card's own container-query classes
// with the real Tailwind compiler and evaluate them at a given card width.
const tailwindTheme = createRequire(import.meta.url).resolve(
  'tailwindcss/theme.css'
);
const tailwind = compile(
  '@import "tailwindcss/theme.css" layer(theme);\n@tailwind utilities;',
  {
    base: process.cwd(),
    loadStylesheet: async (_id, base) => ({
      path: tailwindTheme,
      base,
      content: readFileSync(tailwindTheme, 'utf8'),
    }),
  }
);

async function flexDirectionAt(element: Element, cardWidthPx: number) {
  const classes = Array.from(element.classList);
  if (classes.includes('flex-row')) return 'row';
  const css = (await tailwind).build(classes);
  const rowFrom = [
    ...css.matchAll(
      /@container \(width >= ([\d.]+)(rem|px)\)\s*\{\s*[^{]+\{\s*flex-direction: row;/g
    ),
  ].map(([, size, unit]) => Number(size) * (unit === 'rem' ? 16 : 1));
  return rowFrom.some((minWidth) => cardWidthPx >= minWidth) ? 'row' : 'column';
}

// Measured card widths: the chat column in a 900px-wide window (GUI test
// evidence) and the widest chat column (max-w-[736px]).
const NARROW_CARD_PX = 593;
const WIDEST_CARD_PX = 736;

describe('BlockedWorkspaceOperationCard layout', () => {
  it('stacks the actions below the text in a narrow chat column', async () => {
    const { container } = render(
      <BlockedWorkspaceOperationCard
        operation={blocked}
        action={null}
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const card = container.querySelector('[data-blocked-workspace-operation]');
    expect(card).toHaveClass('@container');
    const layout = card!.firstElementChild!;
    // Text first, then actions, in reading and keyboard order.
    expect(layout.lastElementChild).toContainElement(
      screen.getByRole('button', { name: 'Save as checkpoint' })
    );

    expect(await flexDirectionAt(layout, NARROW_CARD_PX)).toBe('column');
    expect(await flexDirectionAt(layout, WIDEST_CARD_PX)).toBe('row');
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
