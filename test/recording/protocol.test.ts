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

import { describe, expect, it } from 'vitest';
import {
  CommandDecoder,
  validCommand,
  validateChunk,
} from '../../electron/main/recording/protocol';

describe('recording adapter protocol', () => {
  it('decodes split SSE deliveries without duplicating commands', () => {
    const decoder = new CommandDecoder();
    expect(decoder.push('event: command\ndata: {"action":')).toEqual([]);
    expect(decoder.push('"idle"}\n\n')).toEqual([{ action: 'idle' }]);
    expect(decoder.push('')).toEqual([]);
    expect(() => decoder.push('x'.repeat(70_000))).toThrow('overflow');
  });
  it('fences provider generations and expired leases', () => {
    const command = {
      schema_version: 1,
      action: 'start',
      generation: 'live',
      recording_id: 'a'.repeat(32),
      lease_expires_at: Date.now() / 1000 + 10,
      profile: {
        mime: 'video/mp4',
        bitrate: 2_500_000,
        max_bytes: 1000,
        max_seconds: 3600,
      },
    };
    expect(validCommand(command, 'live')).toBe(true);
    expect(validCommand(command, 'stale')).toBe(false);
    expect(
      validCommand({ ...command, recording_id: '../elsewhere' }, 'live')
    ).toBe(false);
    expect(validCommand({ ...command, lease_expires_at: 1 }, 'live')).toBe(
      false
    );
    expect(
      validCommand(
        { ...command, profile: { ...command.profile, mime: 'video/webm' } },
        'live'
      )
    ).toBe(false);
  });
  it('rejects oversized, reordered and malformed media before writing', () => {
    expect(
      validateChunk({ sequence: 0, bytes: new ArrayBuffer(10) }, 0).bytes
        .byteLength
    ).toBe(10);
    expect(() =>
      validateChunk({ sequence: 0, bytes: new ArrayBuffer(10) }, 1)
    ).toThrow();
    expect(() =>
      validateChunk({ sequence: 0, bytes: new Uint8Array(10) }, 0)
    ).toThrow();
    expect(() =>
      validateChunk({ sequence: 0, bytes: new ArrayBuffer(9 * 1024 * 1024) }, 0)
    ).toThrow();
  });
});
