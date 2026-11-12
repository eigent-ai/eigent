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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSpaceFromFolder: vi.fn(async () => true),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@/components/Home/hooks/useNewSpaceCreation', () => ({
  useNewSpaceCreation: () => ({
    createBlankSpace: vi.fn(),
    createSpaceFromFolder: mocks.createSpaceFromFolder,
  }),
}));

import { AgentMessageCard } from '@/components/ChatBox/MessageItem/AgentMessageCard';
import { taskErrorReason } from '@/components/ChatBox/taskErrorPresentation';
import { createSSEAdmissionError } from '@/lib/responseError';
import { classifyError, errorCopy } from '@/lib/usageErrors';

const HOME_COPY = 'Eigent can’t work directly in your home folder.';
const DESCRIPTION =
  'Create a Space from a folder inside your home folder, such as Documents.';

/** The body Brain returns when it refuses a Task in a home-folder Space. */
function refusal(errorCode: string) {
  return new Response(
    JSON.stringify({
      code: 1,
      text: 'Eigent can’t work directly in your home folder. Create a Space from a folder inside it, such as Documents.',
      error_code: errorCode,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

afterEach(() => {
  cleanup();
  mocks.createSpaceFromFolder.mockClear();
});

describe('Space folder refusal', () => {
  it.each([
    ['space_folder_is_home', 'space-folder-home'],
    ['space_folder_holds_app_data', 'space-folder-app-data'],
  ] as const)(
    'turns the %s admission code into its own copy',
    async (code, reason) => {
      const error = await createSSEAdmissionError(refusal(code), {});

      expect(classifyError(error)).toBe(reason);
      expect(error.message).toBe(errorCopy(reason));
      expect(error).toMatchObject({ code, usageReason: reason });
    }
  );

  it('reads the code from an event-native notice', () => {
    expect(
      taskErrorReason({
        severity: 'error',
        content: 'Task failed',
        code: 'space_folder_is_home',
      })
    ).toBe('space-folder-home');
  });

  it.each([
    [
      'the legacy ChatBox',
      { errorReason: 'space-folder-home' as const, content: HOME_COPY },
    ],
    // The event-native timeline shows the same receipt from its content only.
    ['the event-native timeline', { content: `❌ **Error**: ${HOME_COPY}` }],
  ])('offers a folder Space from %s', (_label, props) => {
    render(
      <AgentMessageCard
        id="refused"
        messageStep="error"
        typewriter={false}
        {...props}
      />
    );

    const notice = document.querySelector('[data-task-error]');
    expect(notice?.getAttribute('data-task-error')).toBe('space-folder-home');
    expect(screen.getByText(HOME_COPY)).toBeTruthy();
    expect(screen.getByText(DESCRIPTION)).toBeTruthy();
    expect(screen.queryByText(/Try again/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use a local folder' }));
    expect(mocks.createSpaceFromFolder).toHaveBeenCalledTimes(1);
  });
});
