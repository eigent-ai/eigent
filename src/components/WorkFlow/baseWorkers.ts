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

/** Default workflow agents shown before / alongside task assignment (same data as WorkFlow). */
export const BASE_WORKFLOW_AGENTS: Agent[] = [
  {
    tasks: [],
    agent_id: 'developer_agent',
    tools: [
      'Human Toolkit',
      'Terminal Toolkit',
      'Note Taking Toolkit',
      'Web Deploy Toolkit',
    ],
    name: 'Developer Agent',
    type: 'developer_agent',
    log: [],
    activeWebviewIds: [],
  },
  {
    tasks: [],
    agent_id: 'browser_agent',
    name: 'Browser Agent',
    type: 'browser_agent',
    tools: [
      'Search Toolkit',
      'Browser Toolkit',
      'Human Toolkit',
      'Note Taking Toolkit',
      'Terminal Toolkit',
    ],
    log: [],
    activeWebviewIds: [],
  },
  {
    tasks: [],
    tools: [
      'Video Downloader Toolkit',
      'Audio Analysis Toolkit',
      'Screenshot Toolkit',
      'Open AI Image Toolkit',
      'Human Toolkit',
      'Terminal Toolkit',
      'Note Taking Toolkit',
      'Search Toolkit',
    ],
    agent_id: 'multi_modal_agent',
    name: 'Multi Modal Agent',
    type: 'multi_modal_agent',
    log: [],
    activeWebviewIds: [],
  },
  {
    tasks: [],
    agent_id: 'document_agent',
    name: 'Document Agent',
    tools: [
      'File Write Toolkit',
      'Pptx Toolkit',
      'Human Toolkit',
      'Mark It Down Toolkit',
      'Excel Toolkit',
      'Note Taking Toolkit',
      'Terminal Toolkit',
      'Google Drive Mcp Toolkit',
    ],
    type: 'document_agent',
    log: [],
    activeWebviewIds: [],
  },
];
