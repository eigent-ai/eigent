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

import { fetchPost } from '@/api/http';
import { ArtifactRenderer } from '@/components/Artifacts/ArtifactRenderer';
import { useProjectStore } from '@/store/projectStore';
import type { RuntimeUiArtifactPayload } from '@/types/runtimeArtifact';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  fetchPost: vi.fn().mockResolvedValue({}),
}));

// Stub TriggerDialog to avoid QueryClientProvider requirement in unit tests
vi.mock('@/components/Trigger/TriggerDialog', () => ({
  TriggerDialog: () => null,
}));

const dashboardPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_1',
    type: 'dashboard',
    title: 'Release Dashboard',
    prompt: 'Show release progress.',
    interaction_mode: 'editable',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'summary',
        type: 'markdown',
        title: 'Summary',
        content: 'Show release progress.',
      },
      {
        id: 'metrics',
        type: 'kpi_row',
        title: 'Metrics',
        data_source: 'metrics',
      },
      {
        id: 'prs_table',
        type: 'table',
        title: 'PRs',
        data_source: 'prs',
        columns: ['id', 'title', 'status'],
      },
      {
        id: 'actions',
        type: 'action_row',
        title: 'Actions',
        actions: [
          {
            id: 'summarize',
            label: 'Summarize',
            type: 'agent_action',
            tone: 'information',
          },
        ],
      },
    ],
  },
  data: {
    metrics: { merged_prs: 12 },
    prs: [{ id: '1', title: 'Fix auth', status: 'merged' }],
  },
  state: { selectedRows: [] },
};

const approvalPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_2',
    type: 'approval',
    title: 'Approve Release',
    prompt: 'Approve the release?',
    interaction_mode: 'approval_required',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'summary',
        type: 'markdown',
        title: 'Summary',
        content: 'Approve the release?',
      },
      {
        id: 'approval',
        type: 'approval_panel',
        title: 'Approve Release',
        content: 'Approve the release?',
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            type: 'approval',
            tone: 'success',
          },
          { id: 'reject', label: 'Reject', type: 'reject', tone: 'error' },
        ],
      },
    ],
    actions: [
      { id: 'approve', label: 'Approve', type: 'approval', tone: 'success' },
      { id: 'reject', label: 'Reject', type: 'reject', tone: 'error' },
    ],
  },
  data: {},
  state: {},
};

const selectionPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_3',
    type: 'selection',
    title: 'Pick a strategy',
    prompt: 'Choose a release strategy.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'summary',
        type: 'markdown',
        title: 'Summary',
        content: 'Choose a release strategy.',
      },
      {
        id: 'selection',
        type: 'selection_list',
        title: 'Pick a strategy',
        options: [
          { id: 'ship_today', label: 'Ship today', description: 'Release now' },
          { id: 'ship_next_week', label: 'Ship next week' },
          { id: 'hotfix_only', label: 'Hotfix only' },
        ],
        actions: [
          {
            id: 'submit',
            label: 'Submit',
            type: 'agent_action',
            tone: 'information',
          },
        ],
      },
    ],
    actions: [
      {
        id: 'submit',
        label: 'Submit',
        type: 'agent_action',
        tone: 'information',
      },
    ],
  },
  data: {},
  state: {},
};

const lineChartPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_4',
    type: 'dashboard',
    title: 'Velocity',
    prompt: 'Show velocity.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'chart',
        type: 'line_chart',
        title: 'Weekly velocity',
        data_source: 'chart',
        x_field: 'week',
        y_fields: ['prs'],
      },
    ],
  },
  data: {
    chart: {
      points: [
        { week: 'W1', prs: 5 },
        { week: 'W2', prs: 8 },
        { week: 'W3', prs: 12 },
      ],
      type: 'line',
      x_field: 'week',
      y_fields: ['prs'],
    },
  },
  state: {},
};

const triggerCardPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_6',
    type: 'dashboard',
    title: 'Deployment Summary',
    prompt: 'Deploy v2.1 to production.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'summary',
        type: 'markdown',
        title: 'Summary',
        content: 'Deploy v2.1 to production.',
      },
      {
        id: 'trigger_card',
        type: 'trigger_card',
        title: 'Want to automate this?',
        content: 'Set up a trigger to run this task automatically',
      },
    ],
  },
  data: {},
  state: {},
};

const barChartPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_5',
    type: 'dashboard',
    title: 'Bar',
    prompt: 'Show bars.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'chart',
        type: 'bar_chart',
        title: 'PR counts',
        data_source: 'chart',
        x_field: 'week',
        y_fields: ['prs'],
      },
    ],
  },
  data: {
    chart: {
      points: [
        { week: 'W1', prs: 5 },
        { week: 'W2', prs: 8 },
      ],
    },
  },
  state: {},
};

const statusTilePayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_7',
    type: 'dashboard',
    title: 'Build Status',
    prompt: 'Show build status.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'status',
        type: 'status_tile',
        title: 'CI Pipeline',
        tone: 'success',
        icon: 'check',
        value: 'Passing',
        caption: '3 jobs completed',
        delta: '+2 since yesterday',
      },
    ],
  },
  data: {},
  state: {},
};

const timelinePayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_8',
    type: 'dashboard',
    title: 'Deploy Log',
    prompt: 'Show deploy timeline.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'timeline',
        type: 'timeline',
        title: 'Deploy Events',
        data_source: 'timeline',
      },
    ],
  },
  data: {
    timeline: [
      {
        id: 'e1',
        timestamp: '2m ago',
        label: 'Deploy started',
        tone: 'information',
      },
      { id: 'e2', timestamp: '1m ago', label: 'Tests passed', tone: 'success' },
      {
        id: 'e3',
        timestamp: 'Now',
        label: 'Deployed to prod',
        tone: 'success',
      },
    ],
  },
  state: {},
};

const compareCardPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_9',
    type: 'dashboard',
    title: 'Strategy Comparison',
    prompt: 'Compare deploy strategies.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'compare',
        type: 'compare_card',
        title: 'Pick a strategy',
        data_source: 'compare',
      },
    ],
  },
  data: {
    compare: [
      {
        id: 'blue_green',
        title: 'Blue/Green',
        description: 'Zero-downtime swap',
        features: [
          { label: 'Zero downtime', included: true },
          { label: 'Instant rollback', included: true },
        ],
        cta_label: 'Select',
      },
      {
        id: 'canary',
        title: 'Canary',
        description: 'Gradual rollout',
        features: [
          { label: 'Gradual rollout', included: true },
          { label: 'Instant rollback', included: false },
        ],
        cta_label: 'Select',
      },
    ],
  },
  state: {},
};

const kpiDeltaPayload: RuntimeUiArtifactPayload = {
  artifact: {
    id: 'artifact_10',
    type: 'dashboard',
    title: 'PR Velocity',
    prompt: 'Show PR velocity metrics.',
    interaction_mode: 'view_only',
    layout: { type: 'stack', columns: 1 },
    sections: [
      {
        id: 'metrics',
        type: 'kpi_row',
        title: 'Metrics',
        data_source: 'metrics',
      },
    ],
  },
  data: {
    metrics: {
      merged_prs: { value: 12, delta: '+20%', direction: 'up' },
      open_blockers: { value: 2, delta: '-50%', direction: 'down' },
    },
  },
  state: { selectedRows: [] },
};

function wrap(payload: RuntimeUiArtifactPayload) {
  return render(
    <BrowserRouter>
      <ArtifactRenderer payload={payload} />
    </BrowserRouter>
  );
}

function setupProject() {
  const projectStore = useProjectStore.getState();
  projectStore.getAllProjects().forEach((project) => {
    projectStore.removeProject(project.id);
  });
  const projectId = projectStore.createProject(
    'Artifact Test Project',
    'Testing runtime artifacts'
  );
  const chatStore = projectStore.getActiveChatStore(projectId)!;
  const taskId = chatStore.getState().activeTaskId!;
  chatStore.getState().setHasMessages(taskId, true);
  chatStore.getState().addMessages(taskId, {
    id: 'user-1',
    role: 'user',
    content: 'Show release progress',
    attaches: [],
  });
  return projectId;
}

describe('ArtifactRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupProject();
  });

  it('renders dashboard sections from schema', () => {
    wrap(dashboardPayload);

    expect(screen.getByText('Release Dashboard')).toBeInTheDocument();
    expect(screen.getByText('merged prs')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Fix auth')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /summarize/i })
    ).toBeInTheDocument();
  });

  it('submits action via human-reply endpoint', async () => {
    wrap(dashboardPayload);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /summarize/i }));
    });

    await waitFor(() => {
      expect(fetchPost).toHaveBeenCalledWith(
        expect.stringMatching(/\/human-reply$/),
        expect.objectContaining({
          agent: 'single_agent',
          reply: expect.stringContaining('Runtime UI action: Summarize'),
        })
      );
    });
  });

  it('shows submitted label badge in header after action click', async () => {
    wrap(dashboardPayload);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /summarize/i }));
    });

    await waitFor(() => {
      // Action button disappears after submit
      expect(
        screen.queryByRole('button', { name: /summarize/i })
      ).not.toBeInTheDocument();
      // Submitted label appears in the header badge
      expect(screen.getByText('Summarize')).toBeInTheDocument();
    });
  });

  it('approval submit posts to human-reply endpoint', async () => {
    wrap(approvalPayload);

    const approveBtn = screen.getByRole('button', { name: /approve/i });
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    await waitFor(() => {
      expect(fetchPost).toHaveBeenCalledWith(
        expect.stringMatching(/\/human-reply$/),
        expect.objectContaining({
          agent: 'single_agent',
          reply: expect.stringContaining('Runtime UI action: Approve'),
        })
      );
    });
  });

  it('renders selection_list with options', () => {
    wrap(selectionPayload);

    expect(screen.getByText('Ship today')).toBeInTheDocument();
    expect(screen.getByText('Ship next week')).toBeInTheDocument();
    expect(screen.getByText('Hotfix only')).toBeInTheDocument();
    expect(screen.getByText('Release now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('selection submit is disabled until option chosen', () => {
    wrap(selectionPayload);
    const submitBtn = screen.getByRole('button', { name: /submit/i });
    expect(submitBtn).toBeDisabled();
  });

  it('selection submit posts chosen option via human-reply', async () => {
    wrap(selectionPayload);

    fireEvent.click(screen.getByDisplayValue('ship_today'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    });

    await waitFor(() => {
      expect(fetchPost).toHaveBeenCalledWith(
        expect.stringMatching(/\/human-reply$/),
        expect.objectContaining({
          agent: 'single_agent',
          reply: expect.stringContaining('ship_today'),
        })
      );
    });
  });

  it('renders line_chart SVG', () => {
    wrap(lineChartPayload);
    expect(screen.getByLabelText('line chart')).toBeInTheDocument();
    expect(screen.getByText('Weekly velocity')).toBeInTheDocument();
  });

  it('renders bar_chart SVG', () => {
    wrap(barChartPayload);
    expect(screen.getByLabelText('bar chart')).toBeInTheDocument();
    expect(screen.getByText('PR counts')).toBeInTheDocument();
  });

  it('renders trigger_card with title, subtitle, and action buttons', () => {
    wrap(triggerCardPayload);

    expect(screen.getByText('Want to automate this?')).toBeInTheDocument();
    expect(
      screen.getByText('Set up a trigger to run this task automatically')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add trigger/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /maybe later/i })
    ).toBeInTheDocument();
  });

  it('trigger_card dismisses when Maybe later is clicked', async () => {
    wrap(triggerCardPayload);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /maybe later/i }));
    });

    await waitFor(() => {
      expect(
        screen.queryByText('Want to automate this?')
      ).not.toBeInTheDocument();
    });
  });

  it('renders status_tile with value and delta badge', () => {
    wrap(statusTilePayload);
    expect(screen.getByText('Passing')).toBeInTheDocument();
    expect(screen.getByText('3 jobs completed')).toBeInTheDocument();
    expect(screen.getByText('+2 since yesterday')).toBeInTheDocument();
  });

  it('renders timeline with event labels and timestamps', () => {
    wrap(timelinePayload);
    expect(screen.getByText('Deploy Events')).toBeInTheDocument();
    expect(screen.getByText('Deploy started')).toBeInTheDocument();
    expect(screen.getByText('Tests passed')).toBeInTheDocument();
    expect(screen.getByText('Deployed to prod')).toBeInTheDocument();
    expect(screen.getByText('2m ago')).toBeInTheDocument();
  });

  it('renders compare_card with option titles and features', () => {
    wrap(compareCardPayload);
    expect(screen.getByText('Pick a strategy')).toBeInTheDocument();
    expect(screen.getByText('Blue/Green')).toBeInTheDocument();
    expect(screen.getByText('Canary')).toBeInTheDocument();
    expect(screen.getByText('Zero downtime')).toBeInTheDocument();
    // 'Gradual rollout' appears in both description and feature list — use getAllByText
    expect(
      screen.getAllByText('Gradual rollout').length
    ).toBeGreaterThanOrEqual(1);
    // Two "Select" buttons
    expect(screen.getAllByRole('button', { name: /select/i })).toHaveLength(2);
  });

  it('renders KPI delta chips for rich metric objects', () => {
    wrap(kpiDeltaPayload);
    // Delta badge text appears
    expect(screen.getByText('+20%')).toBeInTheDocument();
    expect(screen.getByText('-50%')).toBeInTheDocument();
  });

  it('collapses card when chevron is clicked', async () => {
    wrap(dashboardPayload);

    // Body initially visible — KPI data shows
    expect(screen.getByText('12')).toBeInTheDocument();

    // Click the chevron toggle button
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /collapse artifact/i })
      );
    });

    // Title always stays visible in the header
    expect(screen.getByText('Release Dashboard')).toBeInTheDocument();
    // Clicking again expands — the button label flips
    expect(
      screen.getByRole('button', { name: /expand artifact/i })
    ).toBeInTheDocument();
  });
});
