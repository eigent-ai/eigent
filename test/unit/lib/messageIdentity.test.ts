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

import {
  resolveSourceEventId,
  resolveSourceMessageId,
} from '@/lib/messageIdentity';
import { describe, expect, it } from 'vitest';

describe('feedback source identity', () => {
  it('prefers committed references over a cloud transport identity', () => {
    const frame = {
      event_id: 'transport-id',
      data: { source_event_id: 'committed-receipt' },
    };
    expect(resolveSourceEventId(frame)).toBe('committed-receipt');
    expect(
      resolveSourceEventId({ ...frame, source_event_id: 'live-receipt' })
    ).toBe('live-receipt');
  });

  it.each([undefined, null, '', ' ', 42, {}, []])(
    'does not promote an invalid cloud reference (%j) into source identity',
    (sourceId) => {
      expect(
        resolveSourceEventId({ data: { source_event_id: sourceId } })
      ).toBeUndefined();
      expect(
        resolveSourceEventId({
          event_id: 'original-event',
          data: { source_event_id: sourceId },
        })
      ).toBe('original-event');
    }
  );

  it('retains explicit message identity precedence through cloud playback', () => {
    const frame = {
      data: {
        message: { message_id: 'logical-message', content: 'Result' },
        source_event_id: 'committed-receipt',
      },
    };
    expect(
      resolveSourceMessageId(frame.data, resolveSourceEventId(frame))
    ).toBe('logical-message');
  });
});
