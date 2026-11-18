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

import { HumanDecisionCard } from '@/components/ChatBox/BottomBox/HumanDecisionCard';
import { createLegacyApprovalVariant } from '@/components/ChatBox/BottomBox/legacyHumanControl';
import { useEventNativeHumanControl } from '@/components/ChatBox/BottomBox/useEventNativeHumanControl';
import { HumanInteractionCard } from '@/components/ChatBox/MessageItem/HumanInteractionCard';
import type { HumanControlInteraction } from '@/lib/projector/control';
import type { HumanInteractionPayload } from '@/service/humanInteractionApi';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  interaction: null as HumanControlInteraction | null,
  isHumanInteractionStillPending: vi.fn(),
  getHumanInteractionReceipt: vi.fn(),
}));

vi.mock('@/hooks/useProjectEventView', () => ({
  useProjectHumanControlProjection: () =>
    mocks.interaction
      ? {
          projectId: mocks.interaction.projectId,
          interactionById: {
            [mocks.interaction.interactionId]: mocks.interaction,
          },
          orderedInteractionIds: [mocks.interaction.interactionId],
          seenEventIds: {},
        }
      : null,
}));

vi.mock('@/service/humanInteractionApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/service/humanInteractionApi')>();
  return {
    ...original,
    decideHumanInteraction: vi.fn(),
    getHumanInteractionReceipt: mocks.getHumanInteractionReceipt,
    isHumanInteractionStillPending: mocks.isHumanInteractionStillPending,
  };
});

vi.mock('@/service/humanInteractionEventReconciliation', () => ({
  reconcileHumanInteractionEvents: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    user_id: 42,
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
  useAuthStore: (selector: (state: { user_id: number }) => unknown) =>
    selector({ user_id: 42 }),
}));

const t = i18next.t.bind(i18next) as (
  key: string,
  options?: Record<string, unknown>
) => string;

/** The ASK frame the Brain streams for a tool approval, as the UI gets it. */
function writeFrame(path: string, id = 'approval:call-1') {
  return {
    interaction_id: id,
    interaction_type: 'approval',
    run_id: 'run-1',
    version: 0,
    approval_id: id,
    title: 'Allow write_to_file?',
    question: 'The agent wants to run write_to_file (filesystem.write).',
    agent: 'developer_agent',
    action_digest: `digest-${path}`,
    safety_class: 'local_write',
    allowed_scopes: ['once', 'space'],
    rule_matcher: {
      action_pattern: 'filesystem.write',
      display_operation: 'filesystem.write',
      resource_pattern: path,
      matcher_kind: 'literal_resource',
    },
    operation: 'filesystem.write',
    target_resources: [path],
    display_arguments: { file_path: path, content: 'hello' },
  } satisfies HumanInteractionPayload & Record<string, unknown>;
}

const commandDigest = `terminal-command:sha256:${'b'.repeat(64)}`;

const shellFrame = {
  interaction_id: 'approval:call-shell',
  interaction_type: 'approval',
  run_id: 'run-1',
  version: 0,
  approval_id: 'approval:call-shell',
  title: 'Allow shell_exec?',
  question: 'The agent wants to run shell_exec (terminal.execute).',
  agent: 'developer_agent',
  action_digest: 'digest-shell',
  allowed_scopes: ['once'],
  rule_matcher: null,
  operation: 'terminal.execute',
  target_resources: [commandDigest],
  display_arguments: { id: 'term-1', command: 'ls -la u15' },
} satisfies HumanInteractionPayload & Record<string, unknown>;

/** The same request as the event-native projector stores it. */
function projected(frame: HumanInteractionPayload): HumanControlInteraction {
  return {
    interactionId: frame.interaction_id,
    interactionType: 'approval',
    status: 'requested',
    projectId: 'project-1',
    runId: frame.run_id,
    sequence: 3,
    lastSequence: 3,
    cloudCursor: null,
    lastCloudCursor: null,
    requestEventId: 'request-1',
    requestSource: 'canonical',
    lastEventId: 'request-1',
    requestedAt: '2026-10-29T10:00:03.000Z',
    updatedAt: '2026-10-29T10:00:03.000Z',
    version: frame.version,
    approvalId: frame.approval_id,
    actionDigest: frame.action_digest,
    allowedScopes: frame.allowed_scopes ?? ['once'],
    title: frame.title,
    prompt: frame.question,
    agent: frame.agent,
    operation: frame.operation,
    targetResources: frame.target_resources ?? [],
    displayArguments: frame.display_arguments ?? {},
    ruleMatcher: null,
    options: [],
    fields: [],
  };
}

function legacyLiveCard(frame: HumanInteractionPayload) {
  const variant = createLegacyApprovalVariant({
    interaction: { ...frame },
    fallbackQuestion: frame.question,
    t,
    onApprove: vi.fn(),
    onReject: vi.fn(),
  });
  if (!variant) throw new Error('Expected an approval');
  return render(
    <HumanDecisionCard
      requestKey={`${frame.run_id}:${frame.interaction_id}`}
      variant={variant}
    />
  );
}

function eventNativeLiveCard(frame: HumanInteractionPayload) {
  mocks.interaction = projected(frame);
  const { result } = renderHook(() =>
    useEventNativeHumanControl({
      projectId: 'project-1',
      activeRunId: frame.run_id,
    })
  );
  const variant = result.current.variant;
  if (variant?.kind !== 'approval') throw new Error('Expected an approval');
  return render(
    <HumanDecisionCard
      requestKey={`${frame.run_id}:${frame.interaction_id}`}
      variant={variant}
    />
  );
}

async function reloadedCard(frame: HumanInteractionPayload) {
  const view = render(<HumanInteractionCard interaction={frame} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled()
  );
  return view;
}

describe('approval card target', () => {
  beforeEach(() => {
    mocks.interaction = null;
    mocks.isHumanInteractionStillPending.mockReset();
    mocks.isHumanInteractionStillPending.mockResolvedValue(true);
    mocks.getHumanInteractionReceipt.mockReset();
    mocks.getHumanInteractionReceipt.mockResolvedValue(null);
  });

  it.each([
    ['live default view', legacyLiveCard],
    ['live event view', eventNativeLiveCard],
    ['reloaded card', reloadedCard],
  ])('%s names the file a write targets', async (_name, renderCard) => {
    await renderCard(writeFrame('u15/act7.txt'));

    expect(screen.getByText('u15/act7.txt')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The agent wants to run write_to_file (filesystem.write).'
      )
    ).toBeInTheDocument();
  });

  it.each([
    ['live default view', legacyLiveCard],
    ['live event view', eventNativeLiveCard],
    ['reloaded card', reloadedCard],
  ])(
    '%s shows the command line a shell call runs, not its digest',
    async (_name, renderCard) => {
      const { container } = await renderCard(shellFrame);

      expect(screen.getByText('ls -la u15')).toBeInTheDocument();
      expect(container).not.toHaveTextContent('terminal-command:sha256:');
    }
  );

  it('gives two live writes from the same tool two different cards', () => {
    const first = legacyLiveCard(writeFrame('u15/act7.txt', 'approval:call-1'));
    const firstText = first.container.textContent;
    first.unmount();
    const second = legacyLiveCard(
      writeFrame('u15/act8.txt', 'approval:call-2')
    );

    expect(firstText).toContain('u15/act7.txt');
    expect(second.container).toHaveTextContent('u15/act8.txt');
    expect(second.container).not.toHaveTextContent('u15/act7.txt');
    expect(second.container.textContent).not.toBe(firstText);
  });

  it('labels the live write target as a file and the command as a command', () => {
    const write = legacyLiveCard(writeFrame('u15/act7.txt'));
    expect(screen.getByText('u15/act7.txt').closest('li')).toHaveTextContent(
      'File:'
    );
    write.unmount();

    legacyLiveCard(shellFrame);
    expect(screen.getByText('ls -la u15').closest('li')).toHaveTextContent(
      'Command:'
    );
  });
});
