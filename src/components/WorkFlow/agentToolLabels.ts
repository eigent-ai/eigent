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

import { formatToolDisplayName } from '@/lib/toolkitIcons';

const agentTools: Record<string, string[]> = {
  developer_agent: [
    '# Terminal & Shell ',
    '# Web Deployment ',
    '# Screen Capture ',
  ],
  browser_agent: ['# Web Browser ', '# Search Engines '],
  multi_modal_agent: [
    '# Image Analysis ',
    '# Video Processing ',
    '# Audio Processing ',
    '# Image Generation ',
  ],
  document_agent: [
    '# File Management ',
    '# Data Processing ',
    '# Document Creation ',
  ],
};

/**
 * Tool label strings shown on workflow nodes and folded workforce cards.
 * Mirrors `node.tsx` logic.
 */
export function getAgentToolLabels(
  agent: Pick<Agent, 'type' | 'tools'> | undefined
): string[] {
  const customTools =
    agent?.tools
      ?.map((tool) => (tool ? '# ' + formatToolDisplayName(String(tool)) : ''))
      .filter(Boolean) || [];
  const preset =
    agent?.type && agentTools[agent.type] ? agentTools[agent.type] : undefined;
  return preset ?? (customTools.length > 0 ? customTools : ['No tools']);
}
