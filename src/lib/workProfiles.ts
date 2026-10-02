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

/**
 * Work role saved to the user's profile during onboarding or in Settings.
 * `others` is the default when the user skips the onboarding step.
 */
export const WORK_PROFILE_IDS = [
  'product-management',
  'engineering',
  'human-resources',
  'finance',
  'marketing',
  'sales',
  'operations',
  'data-science',
  'design',
  'legal',
  'scientist',
  'student',
  'founder',
  'healthcare',
  'writer',
  'educator',
  'consultant',
  'researcher',
  'software-engineer',
  'others',
] as const;

export const DEFAULT_WORK_PROFILE = 'others' as const;

export type WorkProfileId = (typeof WORK_PROFILE_IDS)[number];

export function isWorkProfileId(value: unknown): value is WorkProfileId {
  return (WORK_PROFILE_IDS as readonly unknown[]).includes(value);
}

/** Resolve saved roles from the previous catalogue without retaining old IDs. */
export function normalizeWorkProfile(value: unknown): WorkProfileId {
  if (isWorkProfileId(value)) return value;

  switch (value) {
    case 'backend-engineering':
    case 'frontend-engineering':
    case 'devops':
    case 'data-engineering':
      return 'engineering';
    case 'hr':
      return 'human-resources';
    default:
      return DEFAULT_WORK_PROFILE;
  }
}

// Literal keys so the i18n integrity check can verify each one exists.
export const WORK_PROFILE_LABEL_KEYS: Record<WorkProfileId, string> = {
  'product-management': 'setting.work-profile-product-management',
  engineering: 'setting.work-profile-engineering',
  'human-resources': 'setting.work-profile-human-resources',
  finance: 'setting.work-profile-finance',
  marketing: 'setting.work-profile-marketing',
  sales: 'setting.work-profile-sales',
  operations: 'setting.work-profile-operations',
  'data-science': 'setting.work-profile-data-science',
  design: 'setting.work-profile-design',
  legal: 'setting.work-profile-legal',
  scientist: 'setting.work-profile-scientist',
  student: 'setting.work-profile-student',
  founder: 'setting.work-profile-founder',
  healthcare: 'setting.work-profile-healthcare',
  writer: 'setting.work-profile-writer',
  educator: 'setting.work-profile-educator',
  consultant: 'setting.work-profile-consultant',
  researcher: 'setting.work-profile-researcher',
  'software-engineer': 'setting.work-profile-software-engineer',
  others: 'setting.work-profile-others',
};
