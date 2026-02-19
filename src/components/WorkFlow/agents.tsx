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

export const agentMap: Record<WorkflowAgentType, AgentDisplayInfo> = {
  developer_agent: {
    name: 'Developer Agent',
    icon: <CodeXml size={16} className="text-text-primary" />,
    textColor: 'text-text-developer',
    bgColor: 'bg-bg-fill-coding-active',
    shapeColor: 'bg-bg-fill-coding-default',
    borderColor: 'border-bg-fill-coding-active',
    bgColorLight: 'bg-emerald-200',
  },
  browser_agent: {
    name: 'Browser Agent',
    icon: <Globe size={16} className="text-text-primary" />,
    textColor: 'text-blue-700',
    bgColor: 'bg-bg-fill-browser-active',
    shapeColor: 'bg-bg-fill-browser-default',
    borderColor: 'border-bg-fill-browser-active',
    bgColorLight: 'bg-blue-200',
  },
  document_agent: {
    name: 'Document Agent',
    icon: <FileText size={16} className="text-text-primary" />,
    textColor: 'text-yellow-700',
    bgColor: 'bg-bg-fill-writing-active',
    shapeColor: 'bg-bg-fill-writing-default',
    borderColor: 'border-bg-fill-writing-active',
    bgColorLight: 'bg-yellow-200',
  },
  multi_modal_agent: {
    name: 'Multi Modal Agent',
    icon: <Image size={16} className="text-text-primary" />,
    textColor: 'text-fuchsia-700',
    bgColor: 'bg-bg-fill-multimodal-active',
    shapeColor: 'bg-bg-fill-multimodal-default',
    borderColor: 'border-bg-fill-multimodal-active',
    bgColorLight: 'bg-fuchsia-200',
  },
  social_media_agent: {
    name: 'Social Media Agent',
    icon: <Bird size={16} className="text-text-primary" />,
    textColor: 'text-purple-700',
    bgColor: 'bg-violet-700',
    shapeColor: 'bg-violet-300',
    borderColor: 'border-violet-700',
    bgColorLight: 'bg-purple-50',
  },
};

/** Ordered list of workflow agents (name + icon) for use in skill scope and elsewhere. */
export const WORKFLOW_AGENT_LIST: { name: string; icon: ReactNode }[] = [
  { name: agentMap.developer_agent.name, icon: agentMap.developer_agent.icon },
  { name: agentMap.browser_agent.name, icon: agentMap.browser_agent.icon },
  { name: agentMap.document_agent.name, icon: agentMap.document_agent.icon },
  {
    name: agentMap.multi_modal_agent.name,
    icon: agentMap.multi_modal_agent.icon,
  },
  {
    name: agentMap.social_media_agent.name,
    icon: agentMap.social_media_agent.icon,
  },
];

/** Get display info (name + icon) by agent name; returns undefined if not a workflow agent. */
export function getWorkflowAgentDisplay(
  agentName: string
): { name: string; icon: ReactNode } | undefined {
  const entry = WORKFLOW_AGENT_LIST.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );
  return entry;
}
