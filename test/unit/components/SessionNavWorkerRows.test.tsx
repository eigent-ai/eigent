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
  SessionNavListRows,
  type SessionNavItem,
} from '@/components/SpaceSidebar/SessionNavListRows';
import {
  buildWorkerChildRows,
  sessionHasWorkerRows,
} from '@/components/SpaceSidebar/sessionWorkerRows';
import type { SessionWorker } from '@/lib/projector/chat/workerView';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function worker(
  key: string,
  status: SessionWorker['status'],
  currentTask?: string
): SessionWorker {
  return {
    key,
    name: key,
    status,
    currentTask,
    runIds: ['run-1'],
    firstRunSequence: 1,
    lastCreatedAt: null,
    pendingRequests: status === 'waiting' ? 1 : 0,
  };
}

const workers = [
  worker('Research Agent', 'completed', 'Research competitor pricing'),
  worker('Developer Agent', 'running', 'Draft the page copy'),
];

describe('buildWorkerChildRows', () => {
  it('nests only Workforce Sessions', () => {
    expect(sessionHasWorkerRows('workforce', workers)).toBe(true);
    expect(sessionHasWorkerRows('single-agent', workers)).toBe(false);
    expect(sessionHasWorkerRows('workforce', [])).toBe(false);
    // Unknown mode: more than one agent means Workforce.
    expect(sessionHasWorkerRows(null, workers)).toBe(true);
    expect(sessionHasWorkerRows(null, workers.slice(0, 1))).toBe(false);
  });

  it('is collapsed by default and expands while a worker is waiting', () => {
    const options = {
      mode: 'workforce' as const,
      explicitExpanded: undefined,
      activeWorkerKey: null,
      label: 'Workers: 2',
      onExpandedChange: vi.fn(),
      onWorkerClick: vi.fn(),
    };
    expect(buildWorkerChildRows({ ...options, workers })?.expanded).toBe(false);
    const waiting = [...workers, worker('Browser Agent', 'waiting')];
    expect(
      buildWorkerChildRows({
        ...options,
        workers: waiting,
        explicitExpanded: false,
      })?.expanded
    ).toBe(true);
  });

  it('titles rows by current task and falls back to the worker name', () => {
    const rows = buildWorkerChildRows({
      mode: 'workforce',
      workers: [...workers, worker('Browser Agent', 'failed')],
      explicitExpanded: true,
      activeWorkerKey: null,
      label: 'Workers: 3',
      onExpandedChange: vi.fn(),
      onWorkerClick: vi.fn(),
    })?.rows;
    expect(rows?.map((row) => row.title)).toEqual([
      'Research competitor pricing',
      'Draft the page copy',
      'Browser Agent',
    ]);
    expect(rows?.map((row) => row.sessionLead.kind)).toEqual([
      'finished',
      'running',
      'error',
    ]);
  });
});

function Harness({ onWorkerClick }: { onWorkerClick: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const childRows = buildWorkerChildRows({
    mode: 'workforce',
    workers,
    explicitExpanded: expanded,
    activeWorkerKey: 'Developer Agent',
    label: 'Workers: 2',
    onExpandedChange: setExpanded,
    onWorkerClick,
  });
  const session: SessionNavItem = {
    id: 'session-1',
    title: 'Launch the pricing page',
    sessionLead: {
      kind: 'running',
      Icon: MessageCircle,
      iconClassName: 'text-ds-icon-neutral-default-default',
    },
    childRows,
  };
  return (
    <SessionNavListRows
      sessions={[session]}
      activeSessionId={null}
      folded={false}
      showRowMenu={false}
      onSessionClick={vi.fn()}
    />
  );
}

describe('SessionNavListRows worker rows', () => {
  it('shows the worker count and expands and collapses the rows', async () => {
    const user = userEvent.setup();
    const onWorkerClick = vi.fn();
    render(<Harness onWorkerClick={onWorkerClick} />);

    const toggle = screen.getByRole('button', { name: 'Workers: 2' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2');
    expect(screen.queryByRole('group')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Workers: 2' });
    const developer = within(group).getByRole('button', {
      name: 'Draft the page copy',
    });
    expect(developer).toHaveAttribute('aria-current', 'true');

    await user.click(
      within(group).getByRole('button', { name: 'Research competitor pricing' })
    );
    expect(onWorkerClick).toHaveBeenCalledWith('Research Agent');
  });

  it('expands with Right and collapses with Left on the Session row', async () => {
    const user = userEvent.setup();
    render(<Harness onWorkerClick={vi.fn()} />);

    screen.getByRole('button', { name: 'Launch the pricing page' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('group')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('group')).toBeNull();
  });
});
