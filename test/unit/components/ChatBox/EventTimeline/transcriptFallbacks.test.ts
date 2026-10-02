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
    'prefers the canonical input over %s in either order',
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
  it('suppresses the resume instruction echoed into a Run with canonical input', () => {
    const resume = legacy({
      content: 'Resume the interrupted Run from its persisted Project context.',
    });
    expect(presentedIds([canonical, resume])).toEqual([canonical.eventId]);
    expect(
      presentedIds([canonical, { ...resume, eventType: 'legacy.confirmed' }])
    ).toEqual([canonical.eventId]);
  });
  it.each([
    { runId: 'run-2' },
    { projectId: 'project-2' },
    { eventType: 'legacy.step', legacyStep: 'human_reply' },
    { eventType: 'ui.optimistic_user_query' },
  ])('preserves an input the Run does not own: %j', (overrides) => {
    expect(presentedIds([canonical, legacy(overrides)])).toHaveLength(2);
  });
});
