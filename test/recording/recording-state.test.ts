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

import { recordingElapsed } from '@/components/Recording/RecordingIndicator';
import { mergeRecording, type Recording } from '@/service/recordingApi';
import { describe, expect, it } from 'vitest';

const row: Recording = {
  id: 'clip',
  version: 1,
  space_id: 'space',
  project_id: 'project',
  run_id: 'run',
  attempt_id: null,
  state: 'starting',
  reason: null,
  started_at: null,
  created_at: 100,
  ended_at: null,
  clips: [],
};
describe('recording projection', () => {
  it('never restores an older state after SSE reconnect or a late GET', () => {
    const complete = { ...row, state: 'completed' as const, version: 3 };
    expect(
      mergeRecording([complete], { ...row, state: 'recording', version: 2 })
    ).toEqual([complete]);
    expect(mergeRecording([row], complete)).toEqual([complete]);
  });
  it('uses backend start time and clamps clock skew for elapsed text', () => {
    expect(recordingElapsed(null, 0)).toBe('0:00');
    expect(recordingElapsed(100, 99_000)).toBe('0:00');
    expect(recordingElapsed(100, 165_000)).toBe('1:05');
  });
});
