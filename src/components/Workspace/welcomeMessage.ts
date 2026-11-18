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

/** Translation keys for the line above the new-session composer. */
export type WorkspaceWelcomeKey =
  | 'layout.workspace-welcome'
  | 'layout.workspace-welcome-morning'
  | 'layout.workspace-welcome-afternoon'
  | 'layout.workspace-welcome-evening';

/** Good morning before noon, good afternoon until 6pm, good evening after. */
export function timeOfDayGreetingKey(now: Date): WorkspaceWelcomeKey {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'layout.workspace-welcome-morning';
  if (hour >= 12 && hour < 18) return 'layout.workspace-welcome-afternoon';
  return 'layout.workspace-welcome-evening';
}

/**
 * Picks one of two welcomes at random: the Cowork invitation, or a plain
 * time-of-day greeting in the user's local time.
 */
export function pickWorkspaceWelcomeKey(
  now: Date = new Date(),
  random: () => number = Math.random
): WorkspaceWelcomeKey {
  return random() < 0.5
    ? 'layout.workspace-welcome'
    : timeOfDayGreetingKey(now);
}
