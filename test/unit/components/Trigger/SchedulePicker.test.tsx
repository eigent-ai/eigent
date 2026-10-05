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

import { SchedulePicker } from '@/components/Trigger/SchedulePicker';
import { scheduleToCron } from '@/components/Trigger/automationSchedule';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 12, 15));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('schedule initialization', () => {
  it.each([true, false])(
    'preserves midnight UTC for an existing schedule or an example draft (editing=%s)',
    async (isEditing) => {
      const change = vi.fn();
      render(
        <SchedulePicker
          value="0 0 * * *"
          isEditing={isEditing}
          onChange={change}
        />
      );
      await waitFor(() => expect(change).toHaveBeenLastCalledWith('0 0 * * *'));
    }
  );

  it('starts only the blank create form at the next full local hour', async () => {
    const change = vi.fn();
    render(
      <SchedulePicker value="0 0 * * *" useDefaultTime onChange={change} />
    );
    const expected = scheduleToCron({
      frequency: 'daily',
      hour: 13,
      minute: 0,
    });
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(expected));
  });
});
