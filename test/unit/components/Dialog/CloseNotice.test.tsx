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

import CloseNoticeDialog from '@/components/Dialog/CloseNotice';
import layout from '@/i18n/locales/en-us/layout.json';
import type { CloseExecutionClass, CloseIntent } from '@/shared/windowClose';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function renderNotice(
  intent: CloseIntent,
  executionClass: CloseExecutionClass
) {
  render(
    <CloseNoticeDialog
      open
      intent={intent}
      executionClass={executionClass}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />
  );
}

describe('CloseNoticeDialog', () => {
  it.each([
    ['quit-app', layout['close-durable-quit-message']],
    ['close-window', layout['close-durable-window-message']],
  ] as const)(
    'describes a task from this version by its recorded Run (%s)',
    (intent, message) => {
      renderNotice(intent, 'mixed');

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByText(/older version/)).not.toBeInTheDocument();
    }
  );

  it('keeps the older-version warning for a stream without a Run', () => {
    renderNotice('quit-app', 'legacy-stream');

    expect(
      screen.getByText(layout['close-legacy-quit-message'])
    ).toBeInTheDocument();
  });
});
