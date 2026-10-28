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

export const RECORDING_WORKER_CHUNK = 'recording-worker-chunk';
export const RECORDING_WORKER_REPORT = 'recording-worker-report';
export const RECORDING_WORKER_COMMAND = 'recording-worker-command';
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export interface CaptureCommand {
  schema_version: 1;
  action: 'start' | 'stop' | 'idle';
  generation?: string;
  recording_id?: string;
  lease_expires_at: number;
  profile?: {
    mime: string;
    bitrate: number;
    max_bytes: number;
    max_seconds: number;
  };
}

export function validCommand(
  value: unknown,
  generation: string
): value is CaptureCommand {
  if (!value || typeof value !== 'object') return false;
  const c = value as CaptureCommand;
  if (
    c.schema_version !== 1 ||
    !Number.isFinite(c.lease_expires_at) ||
    c.lease_expires_at * 1000 <= Date.now() ||
    c.lease_expires_at * 1000 > Date.now() + 20_000
  )
    return false;
  if (c.action === 'idle') return true;
  return (
    (c.action === 'start' || c.action === 'stop') &&
    c.generation === generation &&
    typeof c.recording_id === 'string' &&
    /^[a-f0-9]{32}$/.test(c.recording_id) &&
    Boolean(
      c.profile &&
      c.profile.mime === 'video/mp4' &&
      c.profile.bitrate > 0 &&
      c.profile.max_bytes > 0 &&
      c.profile.max_seconds > 0 &&
      c.profile.max_seconds <= 3600
    )
  );
}

/** Bounded SSE decoder shared with the command-transport fixture. */
export class CommandDecoder {
  private buffer = '';
  push(chunk: string): unknown[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    if (this.buffer.length > 64 * 1024)
      throw new Error('recording command overflow');
    const commands: unknown[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const event = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) commands.push(JSON.parse(data));
    }
    return commands;
  }
}

export function validateChunk(
  message: unknown,
  nextSequence: number
): { bytes: Uint8Array; sequence: number } {
  if (!message || typeof message !== 'object')
    throw new Error('invalid recording chunk');
  const { bytes, sequence } = message as { bytes: unknown; sequence: unknown };
  if (
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_CHUNK_BYTES ||
    sequence !== nextSequence
  )
    throw new Error('invalid recording chunk');
  return { bytes: new Uint8Array(bytes), sequence: nextSequence };
}
