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

import { ChartReplyBlock } from '@/components/ChatBox/messages/replyBlocks/ChartReplyBlock';
import { FilesReplyBlock } from '@/components/ChatBox/messages/replyBlocks/FilesReplyBlock';
import { TableReplyBlock } from '@/components/ChatBox/messages/replyBlocks/TableReplyBlock';
import { TriggerSuggestionBlock } from '@/components/ChatBox/messages/replyBlocks/TriggerSuggestionBlock';
import { renderReplyBlock } from '@/components/ChatBox/messages/replyBlocks/index';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// TableReplyBlock
// ---------------------------------------------------------------------------

describe('TableReplyBlock', () => {
  const block = {
    kind: 'table' as const,
    id: 't1',
    title: 'Temperature',
    columns: ['City', 'Temp'],
    rows: [
      ['San Francisco', 62],
      ['New York', 71],
    ] as Array<[string, number]>,
  };

  it('renders table title', () => {
    render(<TableReplyBlock block={block} />);
    expect(screen.getByText('Temperature')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<TableReplyBlock block={block} />);
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('Temp')).toBeInTheDocument();
  });

  it('renders all data rows', () => {
    render(<TableReplyBlock block={block} />);
    expect(screen.getByText('San Francisco')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('New York')).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
  });

  it('renders without a title', () => {
    const { id, columns, rows } = block;
    render(<TableReplyBlock block={{ kind: 'table', id, columns, rows }} />);
    expect(screen.queryByText('Temperature')).not.toBeInTheDocument();
    expect(screen.getByText('City')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ChartReplyBlock — stub placeholder
// ---------------------------------------------------------------------------

describe('ChartReplyBlock', () => {
  const block = {
    kind: 'chart' as const,
    id: 'c1',
    title: 'Sales over time',
    chartType: 'line' as const,
    series: [
      {
        name: 'Revenue',
        data: [
          ['Jan', 100],
          ['Feb', 200],
        ] as Array<[string, number]>,
      },
    ],
  };

  it('renders the title', () => {
    render(<ChartReplyBlock block={block} />);
    expect(screen.getByText('Sales over time')).toBeInTheDocument();
  });

  it('shows a placeholder message', () => {
    render(<ChartReplyBlock block={block} />);
    expect(screen.getByText(/rendering coming soon/i)).toBeInTheDocument();
  });

  it('mentions the chart type', () => {
    render(<ChartReplyBlock block={block} />);
    expect(screen.getByText(/line/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FilesReplyBlock
// ---------------------------------------------------------------------------

describe('FilesReplyBlock', () => {
  const block = {
    kind: 'files' as const,
    id: 'f1',
    files: [
      { name: 'report.pdf', type: 'pdf', path: '/tmp/report.pdf' },
      { name: 'data.csv', type: 'csv', path: '/tmp/data.csv' },
    ] as FileInfo[],
  };

  it('renders file name chips', () => {
    render(<FilesReplyBlock block={block} />);
    expect(screen.getByText('report')).toBeInTheDocument();
    expect(screen.getByText('data')).toBeInTheDocument();
  });

  it('renders file types', () => {
    render(<FilesReplyBlock block={block} />);
    expect(screen.getByText('pdf')).toBeInTheDocument();
    expect(screen.getByText('csv')).toBeInTheDocument();
  });

  it('renders nothing when files array is empty', () => {
    const { container } = render(
      <FilesReplyBlock
        block={{ kind: 'files', id: 'f2', files: [] as FileInfo[] }}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TriggerSuggestionBlock
// ---------------------------------------------------------------------------

describe('TriggerSuggestionBlock', () => {
  const block = {
    kind: 'trigger_suggestion' as const,
    id: 's1',
    prompt: 'Run daily weather check',
    reason: 'This task runs every morning',
    schedule: '0 8 * * *',
  };

  it('renders the reason text', () => {
    withQuery(<TriggerSuggestionBlock block={block} />);
    expect(
      screen.getByText('This task runs every morning')
    ).toBeInTheDocument();
  });

  it('renders a Schedule button', () => {
    withQuery(<TriggerSuggestionBlock block={block} />);
    expect(
      screen.getByRole('button', { name: /schedule/i })
    ).toBeInTheDocument();
  });

  it('renders without a reason', () => {
    const { container } = withQuery(
      <TriggerSuggestionBlock
        block={{ kind: 'trigger_suggestion', id: 's2', prompt: 'Daily task' }}
      />
    );
    expect(container.firstChild).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /schedule/i })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// renderReplyBlock registry
// ---------------------------------------------------------------------------

describe('renderReplyBlock', () => {
  it('returns a table element for kind=table', () => {
    const el = renderReplyBlock({
      kind: 'table',
      id: 'r1',
      columns: ['A'],
      rows: [['x']],
    });
    expect(el).not.toBeNull();
    const { container } = render(el!);
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('returns null for an unknown kind', () => {
    // Force an unknown kind at runtime to verify the switch default.
    const el = renderReplyBlock({ kind: 'unknown' as any, id: 'u1' } as any);
    expect(el).toBeNull();
  });

  it('passes typewriter/onTyping opts to markdown block', () => {
    const onTyping = vi.fn();
    const el = renderReplyBlock(
      { kind: 'markdown', id: 'm1', content: '# Hello' },
      { typewriter: false, onTyping }
    );
    expect(el).not.toBeNull();
    // Just verify it renders without throwing
    render(el!);
  });
});
