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
  SessionHistoryAction,
  SidePanelHeader,
} from '@/components/Session/SidePanel/components/Header';
import type { ProjectEventRuntimeValue } from '@/hooks/useProjectEventRuntime';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: mocks.runtime,
}));

let runtime: ProjectEventRuntimeValue;

function Header() {
  return (
    <SidePanelHeader
      title="Summary"
      mode="single-agent"
      isSidePanelVisible
      onToggle={vi.fn()}
      end={<SessionHistoryAction />}
    />
  );
}

describe('Session history header action', () => {
  beforeEach(() => {
    runtime = {
      projectId: 'project-1',
      snapshot: null,
      hydration: {
        status: 'error',
        errorCode: 'invalid_response',
        eventsTruncated: false,
        hasOlderHistory: false,
        isLoadingOlder: false,
        olderHistoryError: false,
        loadOlder: vi.fn(async () => undefined),
        retry: vi.fn(),
      },
    };
    mocks.runtime.mockImplementation(() => runtime);
  });

  it.each(['invalid_response', 'limit_exceeded', 'unsupported'] as const)(
    'offers one header retry with accessible context for %s',
    (errorCode) => {
      runtime.hydration.errorCode = errorCode;
      render(<Header />);
      const retry = screen.getByRole('button', { name: /Try again/ });
      expect(retry).toHaveAccessibleName(
        errorCode === 'unsupported'
          ? "This version of Eigent can't show session history yet. Try again"
          : 'Some session history could not be loaded. Try again'
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(retry);
      expect(runtime.hydration.retry).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['loading', 'retrying'] as const)(
    'shows %s in place and prevents duplicate manual requests',
    (status) => {
      runtime.hydration.status = status;
      const { rerender } = render(<SessionHistoryAction />);
      const action = screen.getByRole('button');
      expect(action).toBeDisabled();
      expect(action).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('status')).toHaveTextContent(
        status === 'retrying' ? 'Reconnecting…' : 'Loading conversation…'
      );
      fireEvent.click(action);
      expect(runtime.hydration.retry).not.toHaveBeenCalled();
      runtime.hydration.status = 'ready';
      rerender(<SessionHistoryAction />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    }
  );

  it('rebinds retry to the selected Session and hides without one', () => {
    const firstRetry = runtime.hydration.retry;
    const { rerender } = render(<SessionHistoryAction />);
    runtime = {
      ...runtime,
      projectId: 'project-2',
      hydration: { ...runtime.hydration, retry: vi.fn() },
    };
    rerender(<SessionHistoryAction />);
    fireEvent.click(screen.getByRole('button'));
    expect(firstRetry).not.toHaveBeenCalled();
    expect(runtime.hydration.retry).toHaveBeenCalledTimes(1);
    runtime.projectId = null;
    rerender(<SessionHistoryAction />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
