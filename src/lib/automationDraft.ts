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

export interface AutomationDraftV1 {
  version: 1;
  kind: 'automation-draft';
  name: string;
  description: string;
  taskPrompt: string;
  schedule: { text: string; timezone?: string } | null;
  requiredInputs: Array<{ name: string; description: string }>;
  unresolved: string[];
}

const MAX_DRAFT_LENGTH = 12_000;

/** A model-authored draft is display data, never a Trigger API request. */
export function parseAutomationDraft(
  content: string
): AutomationDraftV1 | null {
  const block = /```automation-draft\s*\n([\s\S]*?)\n```/i.exec(content)?.[1];
  if (!block || block.length > MAX_DRAFT_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(block);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const draft = value as Record<string, unknown>;
    if (
      draft.version !== 1 ||
      draft.kind !== 'automation-draft' ||
      typeof draft.name !== 'string' ||
      !draft.name.trim() ||
      draft.name.length > 120 ||
      typeof draft.description !== 'string' ||
      draft.description.length > 1000 ||
      typeof draft.taskPrompt !== 'string' ||
      !draft.taskPrompt.trim() ||
      draft.taskPrompt.length > 8000 ||
      !Array.isArray(draft.requiredInputs) ||
      !Array.isArray(draft.unresolved)
    ) {
      return null;
    }
    if (
      draft.requiredInputs.length > 20 ||
      draft.unresolved.length > 20 ||
      !draft.requiredInputs.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof item.name === 'string' &&
          item.name.length <= 120 &&
          typeof item.description === 'string' &&
          item.description.length <= 500
      ) ||
      !draft.unresolved.every(
        (item) => typeof item === 'string' && item.length <= 500
      )
    ) {
      return null;
    }
    const schedule = draft.schedule;
    if (
      schedule !== null &&
      (typeof schedule !== 'object' ||
        Array.isArray(schedule) ||
        typeof (schedule as Record<string, unknown>).text !== 'string' ||
        ((schedule as Record<string, unknown>).text as string).length > 500 ||
        ('timezone' in schedule &&
          typeof (schedule as Record<string, unknown>).timezone !== 'string'))
    ) {
      return null;
    }
    return draft as unknown as AutomationDraftV1;
  } catch {
    return null;
  }
}
