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
  buildProjectSessionPanelData,
  collectSessionToolCalls,
  extractHttpUrls,
} from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import type { ProjectSessionRun } from '@/hooks/useProjectSessionOverview';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

function makeRun(
  taskId: string,
  isCurrent: boolean,
  task: Record<string, unknown>
): ProjectSessionRun {
  return {
    chatId: `chat-${taskId}`,
    chatStore: {} as ProjectSessionRun['chatStore'],
    taskId,
    createdAt: isCurrent ? 200 : 100,
    updatedAt: isCurrent ? 200 : 100,
    isCurrent,
    task: {
      messages: [],
      taskInfo: [],
      taskRunning: [],
      taskAssigning: [],
      fileList: [],
      webViewUrls: [],
      attaches: [],
      ...task,
    } as ProjectSessionRun['task'],
  };
}

describe('buildProjectSessionPanelData', () => {
  it('pairs toolkit activation and deactivation as request and response', () => {
    const run = makeRun('run-1', true, {
      taskAssigning: [
        {
          agent_id: 'agent-1',
          name: 'Browser Agent',
          type: 'browser_agent',
          tasks: [],
          log: [
            {
              step: AgentStep.ACTIVATE_TOOLKIT,
              timestamp: 1,
              data: {
                toolkit_name: 'Browser Toolkit',
                method_name: 'search',
                message: '{"query":"Eigent"}',
              },
            },
            {
              step: AgentStep.DEACTIVATE_TOOLKIT,
              timestamp: 2,
              data: {
                toolkit_name: 'Browser Toolkit',
                method_name: 'search',
                message: 'https://eigent.ai/docs',
              },
            },
          ],
        },
      ],
    });

    expect(collectSessionToolCalls([run])).toMatchObject([
      {
        toolkitName: 'Browser Toolkit',
        method: 'search',
        input: '{"query":"Eigent"}',
        output: 'https://eigent.ai/docs',
        status: 'done',
        taskId: 'run-1',
      },
    ]);
  });

  it('keeps run ownership internally while folding historical content', () => {
    const current = makeRun('run-current', true, {
      taskInfo: [
        { id: 'p-current', content: 'Current step', status: 'running' },
      ],
      webViewUrls: [
        {
          url: 'https://current.example.com/reference',
          processTaskId: 'p-current',
        },
      ],
    });
    const historical = makeRun('run-old', false, {
      taskInfo: [{ id: 'p-old', content: 'Older step', status: 'completed' }],
      webViewUrls: [
        {
          url: 'https://old.example.com/research',
          processTaskId: 'p-old',
        },
      ],
    });

    const data = buildProjectSessionPanelData([current, historical], []);

    expect(data.progress).toMatchObject([
      { taskId: 'run-current', historical: false, updatedAt: 200 },
      { taskId: 'run-old', historical: true, updatedAt: 100 },
    ]);
    expect(data.resources).toMatchObject([
      { taskId: 'run-current', historical: false, updatedAt: 200 },
      { taskId: 'run-old', historical: true, updatedAt: 100 },
    ]);
  });

  it('extracts unique searched URLs without trailing punctuation', () => {
    expect(
      extractHttpUrls(
        'Read https://example.com/a, then https://example.com/a and https://docs.example.com/page).'
      )
    ).toEqual(['https://example.com/a', 'https://docs.example.com/page']);
  });

  it('uses Open Connector identity and combines its calls across runs', () => {
    const connectorAgent = (timestamp: number) => ({
      agent_id: `agent-${timestamp}`,
      name: 'Agent',
      type: 'single_agent',
      workerInfo: {
        name: 'Agent',
        description: '',
        tools: [],
        mcp_tools: { mcpServers: { connector_gateway: {} } },
        selectedTools: [],
      },
      tasks: [
        {
          id: `task-${timestamp}`,
          content: 'Search Notion',
          status: 'completed',
          toolkits: [
            {
              toolkitName: 'MCPToolkit',
              toolkitMethods: 'notion_search',
              message: '{"query":"roadmap"}',
            },
          ],
        },
      ],
      log: [
        {
          step: AgentStep.ACTIVATE_TOOLKIT,
          timestamp,
          data: {
            toolkit_name: 'MCPToolkit',
            method_name: 'notion_search',
            message: '{"query":"roadmap"}',
          },
        },
        {
          step: AgentStep.DEACTIVATE_TOOLKIT,
          timestamp: timestamp + 1,
          data: {
            toolkit_name: 'MCPToolkit',
            method_name: 'notion_search',
            message: '{"results":[]}',
          },
        },
      ],
    });
    const current = makeRun('run-current', true, {
      taskAssigning: [connectorAgent(3)],
    });
    const historical = makeRun('run-old', false, {
      taskAssigning: [connectorAgent(1)],
    });

    const data = buildProjectSessionPanelData(
      [current, historical],
      [],
      [
        {
          service: 'notion',
          displayName: 'Notion',
          iconUrl: 'https://cdn.example.com/notion.svg',
          actions: [{ id: 'notion_search', name: 'Search Notion' }],
        },
      ]
    );

    expect(data.contextItems).toHaveLength(1);
    expect(data.contextItems[0]).toMatchObject({
      id: 'notion',
      label: 'Notion',
      iconUrl: 'https://cdn.example.com/notion.svg',
      historical: false,
    });
    expect(data.contextItems[0]?.calls.map((call) => call.taskId)).toEqual([
      'run-old',
      'run-current',
    ]);
  });
});
