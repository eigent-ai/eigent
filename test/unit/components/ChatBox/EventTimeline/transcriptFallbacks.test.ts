import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import type { ChatMessageNode } from '@/lib/projector/chat';
import { describe, expect, it } from 'vitest';

const input = (
  eventId: string,
  overrides: Partial<ChatMessageNode> = {}
): ChatMessageNode => ({
  id: eventId,
  eventId,
  projectId: 'project-1',
  runId: 'run-1',
  createdAt: '2026-09-30T12:00:00Z',
  runSequence: 1,
  cloudCursor: null,
  eventType: 'user.message',
  legacyStep: null,
  kind: 'message',
  role: 'user',
  status: 'complete',
  content: 'Now delete step11.txt',
  ...overrides,
});
const canonical = input('user-message:request-1');
const legacy = (overrides: Partial<ChatMessageNode> = {}) =>
  input('cloud-confirmed', {
    eventType: 'legacy.step',
    legacyStep: 'confirmed',
    ...overrides,
  });
const presentedIds = (nodes: ChatMessageNode[]) =>
  presentChatSemanticEntities(nodes).map((n) => n.eventId);

describe('confirmed input fallback ownership', () => {
  it.each(['legacy.step', 'legacy.confirmed'])(
    'prefers the unique canonical input over %s in either order',
    (eventType) => {
      const echo = legacy({ eventType });
      expect(presentedIds([echo, canonical])).toEqual([canonical.eventId]);
      expect(presentedIds([canonical, echo])).toEqual([canonical.eventId]);
      expect(echo.eventType).toBe(eventType);
    }
  );
  it('keeps historical input without a canonical owner', () => {
    expect(presentedIds([legacy()])).toEqual(['cloud-confirmed']);
  });
  it.each([
    { runId: 'run-2' },
    { projectId: 'project-2' },
    { content: 'Delete a different file' },
    { messageId: 'a-separate-input' },
    { eventType: 'legacy.step', legacyStep: 'human_reply' },
    { eventType: 'ui.optimistic_user_query' },
  ])('preserves a distinct or unowned input: %j', (overrides) => {
    expect(presentedIds([canonical, legacy(overrides)])).toHaveLength(2);
  });
  it('uses explicit message identity only when both messages agree', () => {
    const owner = input('user-message:request-1', { messageId: 'message-1' });
    expect(presentedIds([owner, legacy({ messageId: 'message-1' })])).toEqual([
      owner.eventId,
    ]);
    expect(
      presentedIds([owner, legacy({ messageId: 'message-2' })])
    ).toHaveLength(2);
    expect(presentedIds([owner, legacy()])).toHaveLength(2);
  });
  it('preserves two real same-text sends and does not guess ownership in an ambiguous Run', () => {
    const second = input('user-message:request-2');
    expect(presentedIds([canonical, second, legacy()])).toHaveLength(3);
    expect(
      presentedIds([
        canonical,
        input('user-message:request-2', { runId: 'run-2' }),
        legacy(),
      ])
    ).toEqual([canonical.eventId, second.eventId]);
  });
});
