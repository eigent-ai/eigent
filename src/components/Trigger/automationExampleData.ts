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

import {
  AppWindow,
  Bug,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  Database,
  Headset,
  Megaphone,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { RecurringSchedule } from './automationSchedule';

export const AUTOMATION_ROLE_IDS = [
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

export type AutomationRoleId = (typeof AUTOMATION_ROLE_IDS)[number];

export const AUTOMATION_ROLE_ICONS: Record<AutomationRoleId, LucideIcon> = {
  'software-engineer': Code2,
  'backend-engineering': Server,
  'frontend-engineering': AppWindow,
  devops: RefreshCw,
  'data-engineering': Database,
  'product-management': ClipboardCheck,
  marketing: Megaphone,
  sales: TrendingUp,
  'customer-support': Headset,
  hr: Users,
  finance: CircleDollarSign,
  'qa-testing': Bug,
};

export function isAutomationRoleId(value: unknown): value is AutomationRoleId {
  return (
    typeof value === 'string' &&
    (AUTOMATION_ROLE_IDS as readonly string[]).includes(value)
  );
}

/** Copy lives under `triggers.examples.<id>.{title,description,prompt}`. */
export type AutomationExample = {
  id: string;
  roleId: AutomationRoleId;
  schedule: RecurringSchedule;
};

const daily = (hour: number, minute = 0): RecurringSchedule => ({
  frequency: 'daily',
  hour,
  minute,
});
const weekly = (
  weekday: number,
  hour: number,
  minute = 0
): RecurringSchedule => ({
  frequency: 'weekly',
  hour,
  minute,
  weekdays: [weekday],
});
const monthly = (
  dayOfMonth: number,
  hour: number,
  minute = 0
): RecurringSchedule => ({ frequency: 'monthly', hour, minute, dayOfMonth });

const MON = 1;
const WED = 3;
const THU = 4;
const FRI = 5;

export const AUTOMATION_EXAMPLES: AutomationExample[] = [
  {
    id: 'map-unfamiliar-module',
    roleId: 'software-engineer',
    schedule: weekly(MON, 9),
  },
  {
    id: 'trace-request-end-to-end',
    roleId: 'software-engineer',
    schedule: daily(10),
  },
  {
    id: 'weekly-flaky-test-report',
    roleId: 'software-engineer',
    schedule: weekly(MON, 9),
  },
  {
    id: 'api-contract-diff',
    roleId: 'backend-engineering',
    schedule: daily(18),
  },
  {
    id: 'slow-query-digest',
    roleId: 'backend-engineering',
    schedule: weekly(MON, 8),
  },
  {
    id: 'dependency-vulnerability-scan',
    roleId: 'backend-engineering',
    schedule: weekly(WED, 9),
  },
  {
    id: 'component-usage-audit',
    roleId: 'frontend-engineering',
    schedule: weekly(MON, 9),
  },
  {
    id: 'bundle-size-watch',
    roleId: 'frontend-engineering',
    schedule: daily(18),
  },
  {
    id: 'broken-link-sweep',
    roleId: 'frontend-engineering',
    schedule: weekly(MON, 7),
  },
  { id: 'daily-bug-triage', roleId: 'devops', schedule: daily(8) },
  {
    id: 'weekly-incident-summary',
    roleId: 'devops',
    schedule: weekly(FRI, 16),
  },
  { id: 'infra-cost-digest', roleId: 'devops', schedule: weekly(FRI, 9) },
  {
    id: 'pipeline-failure-digest',
    roleId: 'data-engineering',
    schedule: daily(7),
  },
  {
    id: 'schema-drift-check',
    roleId: 'data-engineering',
    schedule: daily(6, 30),
  },
  {
    id: 'sample-dataset-generator',
    roleId: 'data-engineering',
    schedule: weekly(MON, 9),
  },
  {
    id: 'weekly-feature-usage-recap',
    roleId: 'product-management',
    schedule: weekly(MON, 9),
  },
  {
    id: 'customer-feedback-digest',
    roleId: 'product-management',
    schedule: weekly(FRI, 16),
  },
  {
    id: 'competitor-release-watch',
    roleId: 'product-management',
    schedule: weekly(MON, 10),
  },
  {
    id: 'campaign-performance-recap',
    roleId: 'marketing',
    schedule: weekly(MON, 9),
  },
  {
    id: 'content-calendar-draft',
    roleId: 'marketing',
    schedule: weekly(THU, 15),
  },
  { id: 'brand-mention-sweep', roleId: 'marketing', schedule: daily(17) },
  {
    id: 'pipeline-health-digest',
    roleId: 'sales',
    schedule: weekly(MON, 8, 30),
  },
  { id: 'meeting-prep-brief', roleId: 'sales', schedule: daily(8) },
  { id: 'lead-follow-up-reminder', roleId: 'sales', schedule: daily(9) },
  { id: 'inbox-triage', roleId: 'customer-support', schedule: daily(7) },
  {
    id: 'draft-urgent-replies',
    roleId: 'customer-support',
    schedule: daily(7, 30),
  },
  {
    id: 'weekly-satisfaction-recap',
    roleId: 'customer-support',
    schedule: weekly(FRI, 16),
  },
  { id: 'new-hire-paperwork-check', roleId: 'hr', schedule: daily(9) },
  { id: 'policy-document-review', roleId: 'hr', schedule: monthly(1, 10) },
  { id: 'hiring-pipeline-digest', roleId: 'hr', schedule: weekly(FRI, 16) },
  { id: 'expense-report-review', roleId: 'finance', schedule: daily(10) },
  { id: 'monthly-close-checklist', roleId: 'finance', schedule: monthly(2, 9) },
  { id: 'vendor-invoice-triage', roleId: 'finance', schedule: daily(8) },
  { id: 'flaky-test-tracker', roleId: 'qa-testing', schedule: daily(8) },
  {
    id: 'regression-risk-summary',
    roleId: 'qa-testing',
    schedule: daily(17, 30),
  },
  {
    id: 'test-coverage-digest',
    roleId: 'qa-testing',
    schedule: weekly(MON, 9),
  },
];

/** Each role shows its own three examples, then the lead example of three related roles. */
const RELATED_ROLES: Record<
  AutomationRoleId,
  [AutomationRoleId, AutomationRoleId, AutomationRoleId]
> = {
  'software-engineer': ['qa-testing', 'devops', 'product-management'],
  'backend-engineering': ['devops', 'data-engineering', 'software-engineer'],
  'frontend-engineering': [
    'software-engineer',
    'qa-testing',
    'product-management',
  ],
  devops: ['backend-engineering', 'software-engineer', 'qa-testing'],
  'data-engineering': ['backend-engineering', 'product-management', 'devops'],
  'product-management': ['marketing', 'customer-support', 'sales'],
  marketing: ['product-management', 'sales', 'customer-support'],
  sales: ['marketing', 'customer-support', 'product-management'],
  'customer-support': ['product-management', 'sales', 'hr'],
  hr: ['finance', 'product-management', 'customer-support'],
  finance: ['hr', 'sales', 'product-management'],
  'qa-testing': ['software-engineer', 'devops', 'frontend-engineering'],
};

/** Shown before a role is set: one example each from six different roles. */
const DEFAULT_EXAMPLE_IDS = [
  'meeting-prep-brief',
  'campaign-performance-recap',
  'hiring-pipeline-digest',
  'expense-report-review',
  'inbox-triage',
  'weekly-feature-usage-recap',
];

const examplesById = new Map(AUTOMATION_EXAMPLES.map((ex) => [ex.id, ex]));
const examplesForRole = (roleId: AutomationRoleId) =>
  AUTOMATION_EXAMPLES.filter((ex) => ex.roleId === roleId);

export function getExamplesForRole(
  roleId: AutomationRoleId | null
): AutomationExample[] {
  if (!roleId) {
    return DEFAULT_EXAMPLE_IDS.map((id) => examplesById.get(id)!);
  }
  const related = RELATED_ROLES[roleId].map(
    (relatedRole) => examplesForRole(relatedRole)[0]
  );
  return [...examplesForRole(roleId), ...related];
}
