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

import { RunNavRows, type RunNavItem } from '@/components/Runs/RunNavRows';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({
    children,
    content,
    enabled = true,
  }: {
    children: ReactNode;
    content: ReactNode;
    enabled?: boolean;
  }) => (
    <div data-run-tooltip-enabled={enabled ? 'true' : 'false'}>
      {children}
      {enabled ? <span data-run-tooltip-content>{content}</span> : null}
    </div>
  ),
}));

const run: RunNavItem = {
  runId: 'run-1',
  title: 'Research suppliers',
  runLead: {
    kind: 'idle',
    Icon: MessageCircle,
    iconClassName: 'text-ds-icon-neutral-default-default',
  },
};

describe('RunNavRows', () => {
  it('marks and opens the active Run', async () => {
    const user = userEvent.setup();
    const onRunClick = vi.fn();

    render(
      <RunNavRows
        runs={[run]}
        activeRunId={run.runId}
        onRunClick={onRunClick}
        onDeleteRun={vi.fn()}
      />
    );

    const runButton = screen.getByRole('button', { name: run.title });
    expect(runButton).toHaveAttribute('aria-current', 'true');

    await user.click(runButton);

    expect(onRunClick).toHaveBeenCalledOnce();
    expect(onRunClick).toHaveBeenCalledWith(run.runId);
  });

  it('shows Automation metadata and deletes the selected Run', async () => {
    const user = userEvent.setup();
    const onRunClick = vi.fn();
    const onDeleteRun = vi.fn();
    const { container } = render(
      <RunNavRows
        runs={[{ ...run, source: 'trigger', trailing: '2m' }]}
        activeRunId={null}
        onRunClick={onRunClick}
        onDeleteRun={onDeleteRun}
      />
    );

    expect(screen.getByLabelText('Automation run')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(
      container.querySelector('[data-run-tooltip-enabled="true"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-run-tooltip-content]')
    ).toHaveTextContent(run.title);

    await user.tab();
    expect(
      screen.getByRole('button', { name: /Research suppliers/ })
    ).toHaveFocus();
    await user.tab();
    const moreActions = screen.getByRole('button', { name: 'More actions' });
    expect(moreActions).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(
        container.querySelector('[data-run-tooltip-enabled="false"]')
      ).toBeInTheDocument()
    );
    expect(
      container.querySelector('[data-run-tooltip-content]')
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete run' })
    );

    expect(onDeleteRun).toHaveBeenCalledOnce();
    expect(onDeleteRun).toHaveBeenCalledWith(run.runId);
    expect(onRunClick).not.toHaveBeenCalled();
  });
});
