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

import { Bird, CodeXml, FileText, Globe, Image } from 'lucide-react';
import type { ReactNode } from 'react';

export type WorkflowAgentType =
  | 'developer_agent'
  | 'browser_agent'
  | 'document_agent'
  | 'multi_modal_agent'
  | 'social_media_agent';

export interface AgentDisplayInfo {
  name: string;
  icon: ReactNode;
  textColor: string;
  bgColor: string;
  shapeColor: string;
  borderColor: string;
  bgColorLight: string;
}

/**
 * Classes for the small top-right role badge on agent tiles. Must be full literal
 * strings (including `!`) so Tailwind emits them, and `!text-*` beats
 * `button .lucide` in `src/style/index.css`.
 */
export const WORKFLOW_AGENT_SUB_ICON_CLASS: Record<WorkflowAgentType, string> =
  {
    developer_agent:
      '!h-[10px] !w-[10px] shrink-0 !text-ds-text-terminal-default-default',
    browser_agent: '!h-[10px] !w-[10px] shrink-0 !text-blue-700',
    document_agent: '!h-[10px] !w-[10px] shrink-0 !text-yellow-700',
    multi_modal_agent: '!h-[10px] !w-[10px] shrink-0 !text-fuchsia-700',
    social_media_agent: '!h-[10px] !w-[10px] shrink-0 !text-purple-700',
  };

export const agentMap: Record<WorkflowAgentType, AgentDisplayInfo> = {
  developer_agent: {
    name: 'Developer Agent',
    icon: (
      <CodeXml size={16} className="text-ds-text-neutral-default-default" />
    ),
    textColor: 'text-ds-text-terminal-default-default',
    bgColor: 'bg-ds-bg-terminal-default-default',
    shapeColor: 'bg-ds-bg-terminal-subtle-default',
    borderColor: 'border-ds-border-terminal-default-default',
    bgColorLight: 'bg-emerald-200',
  },
  browser_agent: {
    name: 'Browser Agent',
    icon: <Globe size={16} className="text-ds-text-neutral-default-default" />,
    textColor: 'text-blue-700',
    bgColor: 'bg-ds-bg-browser-default-default',
    shapeColor: 'bg-ds-bg-browser-subtle-default',
    borderColor: 'border-ds-border-browser-default-default',
    bgColorLight: 'bg-blue-200',
  },
  document_agent: {
    name: 'Document Agent',
    icon: (
      <FileText size={16} className="text-ds-text-neutral-default-default" />
    ),
    textColor: 'text-yellow-700',
    bgColor: 'bg-ds-bg-document-default-default',
    shapeColor: 'bg-ds-bg-document-subtle-default',
    borderColor: 'border-ds-border-document-default-default',
    bgColorLight: 'bg-yellow-200',
  },
  multi_modal_agent: {
    name: 'Multi Modal Agent',
    icon: <Image size={16} className="text-ds-text-neutral-default-default" />,
    textColor: 'text-fuchsia-700',
    bgColor: 'bg-ds-bg-neutral-default-default',
    shapeColor: 'bg-ds-bg-neutral-subtle-default',
    borderColor: 'border-ds-border-neutral-default-default',
    bgColorLight: 'bg-fuchsia-200',
  },
  social_media_agent: {
    name: 'Social Media Agent',
    icon: <Bird size={16} className="text-ds-text-neutral-default-default" />,
    textColor: 'text-purple-700',
    bgColor: 'bg-violet-700',
    shapeColor: 'bg-violet-300',
    borderColor: 'border-violet-700',
    bgColorLight: 'bg-purple-50',
  },
};

/** Ordered list of workflow agents (id + name + icon) for use in skill scope and elsewhere. */
export const WORKFLOW_AGENT_LIST: {
  id: WorkflowAgentType;
  name: string;
  icon: ReactNode;
}[] = [
  {
    id: 'developer_agent',
    name: agentMap.developer_agent.name,
    icon: agentMap.developer_agent.icon,
  },
  {
    id: 'browser_agent',
    name: agentMap.browser_agent.name,
    icon: agentMap.browser_agent.icon,
  },
  {
    id: 'document_agent',
    name: agentMap.document_agent.name,
    icon: agentMap.document_agent.icon,
  },
  {
    id: 'multi_modal_agent',
    name: agentMap.multi_modal_agent.name,
    icon: agentMap.multi_modal_agent.icon,
  },
  {
    id: 'social_media_agent',
    name: agentMap.social_media_agent.name,
    icon: agentMap.social_media_agent.icon,
  },
];

/** Get display info (name + icon) by agent name; returns undefined if not a workflow agent. */
export function getWorkflowAgentDisplay(
  agentName: string
): { name: string; icon: ReactNode } | undefined {
  const entry = WORKFLOW_AGENT_LIST.find(
    (a) => a.id.toLowerCase() === agentName.toLowerCase()
  );
  if (!entry) return undefined;
  return { name: entry.name, icon: entry.icon };
}
