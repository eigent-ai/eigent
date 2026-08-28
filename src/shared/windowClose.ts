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

export const WINDOW_CLOSE_REQUEST_CHANNEL = 'before-close' as const;
export const WINDOW_CLOSE_RESPONSE_CHANNEL = 'window-close-response' as const;

export const CLOSE_INTENTS = ['close-window', 'quit-app'] as const;

export type CloseIntent = (typeof CLOSE_INTENTS)[number];

export const CLOSE_EXECUTION_CLASSES = [
  'canonical-durable',
  'legacy-stream',
  'mixed',
  'unknown',
] as const;

export type CloseExecutionClass = (typeof CLOSE_EXECUTION_CLASSES)[number];

export interface WindowCloseRequest {
  intent: CloseIntent;
}

export interface WindowCloseResponse extends WindowCloseRequest {
  action: 'acknowledge' | 'confirm' | 'cancel';
}

export function isCloseIntent(value: unknown): value is CloseIntent {
  return (
    typeof value === 'string' &&
    (CLOSE_INTENTS as readonly string[]).includes(value)
  );
}

export function isWindowCloseRequest(
  value: unknown
): value is WindowCloseRequest {
  if (!value || typeof value !== 'object') return false;
  return isCloseIntent((value as Partial<WindowCloseRequest>).intent);
}

export function isWindowCloseResponse(
  value: unknown
): value is WindowCloseResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<WindowCloseResponse>;
  return (
    isCloseIntent(response.intent) &&
    (response.action === 'acknowledge' ||
      response.action === 'confirm' ||
      response.action === 'cancel')
  );
}
