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

import { TaskWorkLogAccordion } from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';
import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';

vi.unmock('react-i18next');

afterEach(async () => {
  await act(async () => {
    await i18next.changeLanguage('en-US');
  });
});

it('updates existing memoized tool rows when the interface language changes', async () => {
  i18next.addResourceBundle(
    'de',
    'translation',
    { chat: { 'call-title-command-done-target': '{{target}} ausgeführt' } },
    true,
    true
  );
  i18next.addResourceBundle(
    'ja',
    'translation',
    { chat: { 'call-title-command-done-target': '{{target}} を実行しました' } },
    true,
    true
  );
  const log = [
    { step: AgentStep.ACTIVATE_AGENT, data: {} },
    {
      step: AgentStep.ACTIVATE_TOOLKIT,
      data: {
        toolkit_name: 'Terminal Toolkit',
        method_name: 'shell exec',
        message: "command='npm --version'",
      },
    },
    {
      step: AgentStep.DEACTIVATE_TOOLKIT,
      data: {
        toolkit_name: 'Terminal Toolkit',
        method_name: 'shell exec',
        message: '10.0.0',
      },
    },
  ];
  const state = {
    tasks: {
      'task-1': {
        status: ChatTaskStatus.RUNNING,
        sessionMode: SessionMode.WORKFORCE,
        taskTime: 0,
        elapsed: 0,
        messages: [],
        askList: [],
        taskAssigning: [
          {
            agent_id: 'agent-1',
            type: 'browser',
            name: 'Researcher',
            tasks: [],
            log,
          },
        ],
      },
    },
  };
  const store = {
    getState: () => state,
    subscribe: () => () => undefined,
  } as unknown as VanillaChatStore;
  await i18next.changeLanguage('de');
  render(
    <I18nextProvider i18n={i18next}>
      <TaskWorkLogAccordion chatStore={store} taskId="task-1" />
    </I18nextProvider>
  );
  expect(
    screen.getByRole('button', { name: 'npm --version ausgeführt' })
  ).toBeInTheDocument();
  await act(async () => {
    await i18next.changeLanguage('ja');
  });
  expect(
    screen.getByRole('button', { name: 'npm --version を実行しました' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'npm --version ausgeführt' })
  ).not.toBeInTheDocument();
});
