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

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Why a Run stopped, as recorded by the Brain (`RunTerminalReason`).
 *
 * Only this closed set is localized. The accompanying terminal detail is
 * diagnostic text from the Brain or model and is shown verbatim.
 */
export const RUN_TERMINAL_REASONS = [
  'completed',
  'user_cancelled',
  'deadline_exceeded',
  'approval_expired',
  'brain_restart',
  'runtime_lost',
  'error',
  'budget_exhausted',
] as const;

export type RunTerminalReason = (typeof RUN_TERMINAL_REASONS)[number];

export function runTerminalReason(value: unknown): RunTerminalReason | null {
  return RUN_TERMINAL_REASONS.includes(value as RunTerminalReason)
    ? (value as RunTerminalReason)
    : null;
}

export function runTerminalReasonText(
  reason: RunTerminalReason | null | undefined,
  t: Translate
): string {
  return reason ? t(`chat.run-terminal-reason-${reason}`) : '';
}
