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

import type { ProjectGroup } from '@/types/history';
import type { BillingSummary, UserProfile } from '@web/types';

export const MOCK_USER = {
  token: 'mock-web-ui-token',
  email: 'demo@eigent.ai',
  username: 'demo',
  user_id: 1,
  avatar: '',
  nickname: 'Demo User',
  fullname: 'Demo User',
  work_desc: 'Building with Eigent Dispatch mock data.',
  credits: 500,
};

export const MOCK_BILLING: BillingSummary = {
  email: MOCK_USER.email,
  subscription_mode: 'trial',
  plan_name: 'Pro Trial',
  credits_total: 500,
  credits_daily: 50,
  credits_monthly: 450,
  credits_permanent: 0,
};

export const MOCK_PROFILE: UserProfile = {
  fullname: MOCK_USER.fullname,
  nickname: MOCK_USER.nickname,
  work_desc: MOCK_USER.work_desc,
};

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const MOCK_PROJECT_GROUPS: ProjectGroup[] = [
  {
    project_id: 'mock-project-research',
    project_name: 'Competitor pricing research',
    total_tokens: 1840,
    task_count: 2,
    total_triggers: 0,
    latest_task_date: hoursAgo(2),
    last_prompt: 'Summarize the top 5 competitor pricing pages',
    tasks: [
      {
        id: 101,
        task_id: 'mock-task-research-1',
        project_id: 'mock-project-research',
        question: 'Summarize the top 5 competitor pricing pages',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 1240,
        status: 2,
        summary: 'Compiled a comparison table of competitor tiers and limits.',
        created_at: hoursAgo(5),
        updated_at: hoursAgo(2),
      },
      {
        id: 102,
        task_id: 'mock-task-research-2',
        project_id: 'mock-project-research',
        question: 'Draft a one-page brief from the pricing research',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 600,
        status: 2,
        summary: 'Created an executive brief with recommendations.',
        created_at: hoursAgo(3),
        updated_at: hoursAgo(2),
      },
    ],
    total_completed_tasks: 2,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 920,
  },
  {
    project_id: 'mock-project-onboarding',
    project_name: 'Customer onboarding flow',
    total_tokens: 420,
    task_count: 1,
    total_triggers: 0,
    latest_task_date: hoursAgo(8),
    last_prompt: 'Outline a 5-step onboarding checklist for new teams',
    tasks: [
      {
        id: 201,
        task_id: 'mock-task-onboarding-1',
        project_id: 'mock-project-onboarding',
        question: 'Outline a 5-step onboarding checklist for new teams',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 420,
        status: 1,
        created_at: hoursAgo(8),
        updated_at: hoursAgo(1),
      },
    ],
    total_completed_tasks: 0,
    total_ongoing_tasks: 1,
    average_tokens_per_task: 420,
  },
  {
    project_id: 'mock-project-release',
    project_name: 'Release notes draft',
    total_tokens: 890,
    task_count: 1,
    total_triggers: 0,
    latest_task_date: hoursAgo(24),
    last_prompt: 'Draft release notes for v2.4 from merged PR titles',
    tasks: [
      {
        id: 301,
        task_id: 'mock-task-release-1',
        project_id: 'mock-project-release',
        question: 'Draft release notes for v2.4 from merged PR titles',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 890,
        status: 2,
        summary:
          'Generated categorized release notes with highlights and breaking changes.',
        created_at: hoursAgo(26),
        updated_at: hoursAgo(24),
      },
    ],
    total_completed_tasks: 1,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 890,
  },
  {
    project_id: 'mock-project-weekly-report',
    project_name: 'Weekly team status report',
    total_tokens: 1560,
    task_count: 2,
    total_triggers: 0,
    latest_task_date: hoursAgo(12),
    last_prompt: 'Summarize progress from Jira and Slack for the weekly update',
    tasks: [
      {
        id: 401,
        task_id: 'mock-task-weekly-1',
        project_id: 'mock-project-weekly-report',
        question:
          'Summarize progress from Jira and Slack for the weekly update',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 980,
        status: 2,
        summary: 'Compiled shipped items, blockers, and next-week priorities.',
        created_at: hoursAgo(14),
        updated_at: hoursAgo(12),
      },
      {
        id: 402,
        task_id: 'mock-task-weekly-2',
        project_id: 'mock-project-weekly-report',
        question: 'Turn the weekly summary into a Slack post',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 580,
        status: 2,
        summary: 'Formatted a concise Slack update with bullet points.',
        created_at: hoursAgo(13),
        updated_at: hoursAgo(12),
      },
    ],
    total_completed_tasks: 2,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 780,
  },
  {
    project_id: 'mock-project-api-docs',
    project_name: 'API docs refresh',
    total_tokens: 310,
    task_count: 1,
    total_triggers: 0,
    latest_task_date: hoursAgo(4),
    last_prompt: 'Review the auth endpoints section for outdated examples',
    tasks: [
      {
        id: 501,
        task_id: 'mock-task-api-docs-1',
        project_id: 'mock-project-api-docs',
        question: 'Review the auth endpoints section for outdated examples',
        language: 'en',
        model_platform: 'openai',
        model_type: 'gpt-5-mini',
        max_retries: 0,
        tokens: 310,
        status: 1,
        created_at: hoursAgo(4),
        updated_at: hoursAgo(1),
      },
    ],
    total_completed_tasks: 0,
    total_ongoing_tasks: 1,
    average_tokens_per_task: 310,
  },
];

export const MOCK_PROVIDERS = [
  {
    id: 1,
    provider_name: 'openai',
    model_type: 'gpt-5-mini',
    api_key: 'mock-key',
    prefer: true,
    is_valid: true,
  },
];

export const MOCK_SUBSCRIPTION = {
  plan_key: 'pro_trial',
  is_trialing: true,
  monthly_credits: 500,
  trial_daily_credits_limit: 50,
  trial_daily_credits_used: 12,
  trial_daily_credits_remaining: 38,
  trial_total_credits_limit: 500,
  trial_total_credits_used: 48,
  trial_total_credits_remaining: 452,
};
