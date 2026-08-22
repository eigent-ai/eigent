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
  WorkSessionNavRows,
  type WorkSessionNavItem,
} from '@/components/SpaceSidebar/WorkSessionNavRows';
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
    <div data-work-session-tooltip-enabled={enabled ? 'true' : 'false'}>
      {children}
      {enabled ? (
        <span data-work-session-tooltip-content>{content}</span>
      ) : null}
    </div>
  ),
}));

const workSession: WorkSessionNavItem = {
  projectId: 'project-1',
  title: 'Overflowing Session Name',
  runLead: {
    kind: 'idle',
    Icon: MessageCircle,
    iconClassName: 'text-ds-icon-neutral-default-default',
  },
};

describe('WorkSessionNavRows', () => {
  it('lets keyboard users focus and open the Work Session actions menu', async () => {
    const user = userEvent.setup();
    render(
      <>
        {/* Vitest does not load Tailwind's generated stylesheet. Model the
            utility that caused the trigger to leave the tab order so this
            remains a behavioral regression test. */}
        <style>{'.hidden { display: none; }'}</style>
        <WorkSessionNavRows
          workSessions={[workSession]}
          activeProjectId={null}
          folded={false}
          onWorkSessionClick={vi.fn()}
          onPinWorkSession={vi.fn()}
          onEndWorkSession={vi.fn()}
          onDeleteWorkSession={vi.fn()}
        />
      </>
    );

    await user.tab();
    expect(
      screen.getByRole('button', { name: workSession.title })
    ).toHaveFocus();

    await user.tab();
    const moreActions = screen.getByRole('button', {
      name: 'More actions',
    });
    expect(moreActions).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: 'Pin' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'End session' })).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'Delete session' })
    ).toBeVisible();
  });

  it('disables the Work Session tooltip while its row menu is open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WorkSessionNavRows
        workSessions={[workSession]}
        activeProjectId={null}
        folded={false}
        onWorkSessionClick={vi.fn()}
        onPinWorkSession={vi.fn()}
        onEndWorkSession={vi.fn()}
        onDeleteWorkSession={vi.fn()}
      />
    );

    expect(
      container.querySelector('[data-work-session-tooltip-enabled="true"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-work-session-tooltip-content]')
    ).toHaveTextContent(workSession.title);

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    await waitFor(() =>
      expect(
        container.querySelector('[data-work-session-tooltip-enabled="false"]')
      ).toBeInTheDocument()
    );
    expect(
      container.querySelector('[data-work-session-tooltip-content]')
    ).not.toBeInTheDocument();
  });
});
