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
// Licensed under the Apache License, Version 2.0 (the "License");

import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import {
  mergeLocalRemoteCommandStatus,
  remoteControlErrorText,
} from './remoteCommandStatus';

const command = {
  id: 'command-1',
  content: 'Run it',
  type: 'user_message',
  status: 'completed',
};

describe('local Remote Control command projection', () => {
  it('does not let a stale status frame move a command backward', () => {
    const previous = [command];

    const merged = mergeLocalRemoteCommandStatus(previous, {
      ...command,
      status: 'accepted',
    });

    expect(merged[0].status).toBe('completed');
    expect(previous[0].status).toBe('completed');
  });

  it('accepts forward progress and terminal outcomes', () => {
    const accepted = mergeLocalRemoteCommandStatus(
      [{ ...command, status: 'durably_received' }],
      { ...command, status: 'accepted' }
    );
    const completed = mergeLocalRemoteCommandStatus(accepted, command);

    expect(accepted[0].status).toBe('accepted');
    expect(completed[0].status).toBe('completed');
  });

  it('maps stable bridge errors to presentation keys', () => {
    const t = vi.fn((key: string) => key) as unknown as TFunction;

    expect(
      remoteControlErrorText('Desktop Project is not loaded in this Space', t)
    ).toBe('layout.remote-control-error-session-not-loaded');
    expect(
      remoteControlErrorText(
        'Command expired or could not pass its receipt gate',
        t
      )
    ).toBe('layout.remote-control-error-expired');
  });

  it('preserves dynamic server errors and translates an empty fallback', () => {
    const t = vi.fn((key: string) => key) as unknown as TFunction;

    expect(remoteControlErrorText('Server detail 42', t)).toBe(
      'Server detail 42'
    );
    expect(remoteControlErrorText(undefined, t)).toBe('layout.unknown-error');
  });
});
