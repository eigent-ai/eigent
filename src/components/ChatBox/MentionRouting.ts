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

import { AgentStep, ChatTaskStatus } from '@/types/constants';

/** First {{@mentionId}} in user message content (send path embeds this). */
const LEAD_MENTION_REGEX = /\{\{@(\w+)\}\}/;

export function getLeadMentionId(
  content: string | undefined | null
): string | null {
  if (!content) return null;
  const m = content.match(LEAD_MENTION_REGEX);
  return m ? m[1] : null;
}

export function isWorkforceTurn(content: string | undefined | null): boolean {
  const id = getLeadMentionId(content);
  return !id || id === 'workforce';
}

export function isSingleAgentTurn(content: string | undefined | null): boolean {
  const id = getLeadMentionId(content);
  return !!id && id !== 'workforce';
}

/** Align with ProjectSection groupMessagesByQuery AGENT_END routing. */
export const AGENT_NAME_TO_MENTION: Record<string, string> = {
  browser_agent: 'browser',
  developer_agent: 'dev',
  document_agent: 'doc',
  multi_modal_agent: 'media',
  social_media_agent: 'social',
};

export function agentNameToMentionId(
  agentName: string | undefined
): string | null {
  if (!agentName) return null;
  return AGENT_NAME_TO_MENTION[agentName] || agentName;
}

/** Display labels for mention ids (matches UserMessageCard MENTION_LABELS). */
export const MENTION_ID_LABELS: Record<string, string> = {
  workforce: 'Workforce',
  browser: 'Browser Agent',
  dev: 'Developer Agent',
  doc: 'Document Agent',
  media: 'Multi Modal Agent',
  social: 'Social Media Agent',
};

export function getMentionLabelForId(mentionId: string): string {
  return MENTION_ID_LABELS[mentionId] || mentionId;
}

/** Backend agent_name → short label for outcome header (matches prior AGENT_LABEL map). */
export const AGENT_NAME_DISPLAY: Record<string, string> = {
  browser_agent: 'Browser Agent',
  developer_agent: 'Developer Agent',
  document_agent: 'Document Agent',
  multi_modal_agent: 'Multi Modal Agent',
  social_media_agent: 'Social Media Agent',
};

export function getAgentDisplayLabel(agentName: string | undefined): string {
  if (!agentName) return 'Agent';
  return AGENT_NAME_DISPLAY[agentName] || agentName;
}

type TaskLikeForStopVisibility = {
  status: string;
  messages: Array<{
    role?: string;
    content?: string;
    step?: string;
  }>;
  taskAssigning?: unknown[];
};

/**
 * Direct @-agent tasks stay RUNNING until END even after AGENT_END (per chatStore).
 * Hide the floating Stop button once every single-agent user turn has a non-empty AGENT_END.
 * Workforce flows (TO_SUB_TASKS) are unchanged.
 */
export function shouldHideStopForCompletedDirectAgents(
  task: TaskLikeForStopVisibility | null | undefined
): boolean {
  if (!task || task.status !== ChatTaskStatus.RUNNING) return false;
  const hasSubTasks = task.messages.some(
    (m) => m.step === AgentStep.TO_SUB_TASKS
  );
  if (hasSubTasks) return false;
  if (!(task.taskAssigning?.length ?? 0)) return false;

  const singleAgentUserCount = task.messages.filter(
    (m) => m.role === 'user' && isSingleAgentTurn(m.content ?? '')
  ).length;
  if (singleAgentUserCount === 0) return false;

  const agentEndCount = task.messages.filter(
    (m) => m.step === AgentStep.AGENT_END && (m.content?.length ?? 0) > 0
  ).length;

  return agentEndCount >= singleAgentUserCount;
}
