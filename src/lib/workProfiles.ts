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
 * Work profile chosen during onboarding or in Settings. It only tailors the
 * automation examples we show; it never limits what the user can build.
 * `general` is the default when the user skips the onboarding step.
 */
export const WORK_PROFILE_IDS = [
  'software-engineer',
  'backend-engineering',
  'frontend-engineering',
  'devops',
  'data-engineering',
  'product-management',
  'marketing',
  'sales',
  'customer-support',
  'hr',
  'finance',
  'qa-testing',
] as const;

export const DEFAULT_WORK_PROFILE = 'general' as const;

export type WorkProfileId =
  typeof DEFAULT_WORK_PROFILE | (typeof WORK_PROFILE_IDS)[number];

export function isWorkProfileId(value: unknown): value is WorkProfileId {
  return (
    value === DEFAULT_WORK_PROFILE ||
    (WORK_PROFILE_IDS as readonly unknown[]).includes(value)
  );
}

// Literal keys so the i18n integrity check can verify each one exists.
export const WORK_PROFILE_LABEL_KEYS: Record<WorkProfileId, string> = {
  general: 'setting.work-profile-general',
  'software-engineer': 'setting.work-profile-software-engineer',
  'backend-engineering': 'setting.work-profile-backend-engineering',
  'frontend-engineering': 'setting.work-profile-frontend-engineering',
  devops: 'setting.work-profile-devops',
  'data-engineering': 'setting.work-profile-data-engineering',
  'product-management': 'setting.work-profile-product-management',
  marketing: 'setting.work-profile-marketing',
  sales: 'setting.work-profile-sales',
  'customer-support': 'setting.work-profile-customer-support',
  hr: 'setting.work-profile-hr',
  finance: 'setting.work-profile-finance',
  'qa-testing': 'setting.work-profile-qa-testing',
};
