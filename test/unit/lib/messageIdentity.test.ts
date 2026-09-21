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
