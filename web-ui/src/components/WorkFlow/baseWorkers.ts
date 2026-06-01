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

import type { WebAgent } from '@/store/authStore';

export const BASE_WORKFLOW_AGENTS: WebAgent[] = [
  {
    agent_id: 'browser-agent',
    name: 'Browser Agent',
    type: 'browser',
    tasks: [],
    tools: [],
    log: [],
    activeWebviewIds: [],
  },
  {
    agent_id: 'document-agent',
    name: 'Document Agent',
    type: 'document',
    tasks: [],
    tools: [],
    log: [],
    activeWebviewIds: [],
  },
  {
    agent_id: 'terminal-agent',
    name: 'Terminal Agent',
    type: 'terminal',
    tasks: [],
    tools: [],
    log: [],
    activeWebviewIds: [],
  },
];
