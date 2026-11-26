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

import MicrophoneProblemNotice from '@/components/Meetings/MicrophoneProblemNotice';
import { HostProvider } from '@/host';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

function renderNotice(
  problem: Parameters<typeof MicrophoneProblemNotice>[0]['problem'],
  electronAPI: Record<string, unknown> | null
) {
  const onDismiss = vi.fn();
  render(
    <HostProvider host={{ electronAPI, ipcRenderer: null }}>
      <MicrophoneProblemNotice problem={problem} onDismiss={onDismiss} />
    </HostProvider>
  );
  return { onDismiss };
}

describe('MicrophoneProblemNotice', () => {
  it('explains a denied permission and opens the privacy settings', async () => {
    const openMicrophoneSettings = vi.fn(async () => true);
    renderNotice('denied', { openMicrophoneSettings });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Eigent can't use the microphone."
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Open System Settings' })
    );
    expect(openMicrophoneSettings).toHaveBeenCalledOnce();
  });

  it('offers no settings button where the OS has none', () => {
    renderNotice('denied', null);

    expect(
      screen.queryByRole('button', { name: 'Open System Settings' })
    ).not.toBeInTheDocument();
  });

  it('explains other problems and can be dismissed', async () => {
    const { onDismiss } = renderNotice('no-device', {
      openMicrophoneSettings: vi.fn(),
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No microphone was found.'
    );
    expect(
      screen.queryByRole('button', { name: 'Open System Settings' })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
