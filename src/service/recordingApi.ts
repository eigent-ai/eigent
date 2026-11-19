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

import { fetchGet, fetchPost } from '@/api/http';

export type RecordingState =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'finalizing'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'denied';
export interface RecordingClip {
  id: string;
  local_path: string;
  relative_path: string;
  mime: string;
  duration: number;
  bytes: number;
  width: number;
  height: number;
}
export interface Recording {
  id: string;
  version: number;
  space_id: string;
  project_id: string;
  run_id: string;
  attempt_id: string | null;
  state: RecordingState;
  reason: string | null;
  started_at: number | null;
  created_at: number;
  ended_at: number | null;
  clips: RecordingClip[];
}
export interface RecordingCapabilities {
  available: boolean;
  reason: string | null;
  formats: string[];
}
export const ACTIVE_RECORDING_STATES: readonly RecordingState[] = [
  'starting',
  'recording',
  'stopping',
  'finalizing',
];
export const listRecordings = (): Promise<{ recordings: Recording[] }> =>
  fetchGet('/recordings');
export const recordingCapabilities = (): Promise<RecordingCapabilities> =>
  fetchGet('/recordings/capabilities');
export const startRecording = (
  runId: string,
  grantId: string,
  key: string
): Promise<Recording> =>
  fetchPost('/recordings', {
    run_id: runId,
    grant_id: grantId,
    idempotency_key: key,
  });
export const stopRecording = (id: string): Promise<Recording> =>
  fetchPost(`/recordings/${encodeURIComponent(id)}/stop`, {});

export function mergeRecording(
  recordings: readonly Recording[],
  incoming: Recording
): Recording[] {
  const existing = recordings.find((item) => item.id === incoming.id);
  if (existing && existing.version >= incoming.version) return [...recordings];
  return [
    incoming,
    ...recordings.filter((item) => item.id !== incoming.id),
  ].sort((a, b) => b.created_at - a.created_at);
}
