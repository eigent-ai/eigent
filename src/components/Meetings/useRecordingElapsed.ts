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
  recordingElapsedMs,
  useMeetingRecordingStore,
} from '@/store/meetingRecordingStore';
import { useEffect, useState } from 'react';

/** Elapsed recording time, refreshed twice a second while recording. */
export function useRecordingElapsed(): number {
  const phase = useMeetingRecordingStore((state) => state.phase);
  const startedAt = useMeetingRecordingStore((state) => state.startedAt);
  const pausedMs = useMeetingRecordingStore((state) => state.pausedMs);
  const pausedSince = useMeetingRecordingStore((state) => state.pausedSince);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  return recordingElapsedMs(
    { startedAt, pausedMs, pausedSince },
    // While paused the clock stands still at the moment of pausing.
    pausedSince ?? Math.max(now, startedAt ?? now)
  );
}
