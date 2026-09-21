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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Shared identity precedence for the canonical and legacy message readers. */
export function resolveSourceMessageId(
  data: unknown,
  eventId?: unknown
): string | undefined {
  const payload = asRecord(data);
  const messagePayload = { ...payload, ...asRecord(payload.message) };
  const message = asRecord(messagePayload.message);
  for (const value of [
    messagePayload.message_id,
    messagePayload.messageId,
    message.message_id,
    message.messageId,
  ]) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return typeof eventId === 'string' && eventId.trim() ? eventId : undefined;
}
