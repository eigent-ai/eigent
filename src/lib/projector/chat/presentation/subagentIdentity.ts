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

export interface SubagentPresentationIdentityInput {
  subagentName?: string;
  subagentType?: string;
  toolCallId?: string;
  stepId?: string;
  subagentAgentId?: string;
  subagentTaskId?: string;
  fallbackName?: string;
  fallbackSeed?: string;
}

export interface SubagentPresentationIdentity {
  name: string;
  avatarSeed: string;
}

function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return '';
}

function formatSubagentType(value?: string): string {
  const normalized = value?.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Resolve the one display identity shared by the Event Timeline and Session
 * summary. A delegated call keeps its creation identity while lifecycle
 * receipts update status in place, so the avatar never changes when a child
 * process ID arrives later.
 */
export function resolveSubagentPresentationIdentity(
  input: SubagentPresentationIdentityInput
): SubagentPresentationIdentity {
  return {
    name: firstText(
      input.subagentName,
      formatSubagentType(input.subagentType),
      input.fallbackName
    ),
    avatarSeed: firstText(
      input.toolCallId,
      input.stepId,
      input.fallbackSeed,
      input.subagentAgentId,
      input.subagentTaskId,
      'subagent'
    ),
  };
}
