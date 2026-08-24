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

import BottomBox, { type BottomBoxProps } from '@/components/ChatBox/BottomBox';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ChatBox/BottomBox/BoxFooter', () => ({
  BoxFooter: ({ disabled }: { disabled?: boolean }) => (
    <div
      data-testid="project-setup-footer"
      data-disabled={String(!!disabled)}
    />
  ),
}));

vi.mock('@/components/ChatBox/BottomBox/InputBox', () => ({
  Inputbox: ({
    value,
    files = [],
    header,
    onFilesChange,
  }: {
    value?: string;
    files?: { fileName: string; filePath: string }[];
    header?: {
      eyebrow?: string;
      title?: string;
      description?: string;
    };
    onFilesChange?: (files: { fileName: string; filePath: string }[]) => void;
  }) => (
    <div data-testid="text-composer" data-bottom-box-input-surface>
      {header && (header.eyebrow || header.title || header.description) ? (
        <section data-bottom-box-header>
          {header.eyebrow}
          {header.title}
          {header.description}
        </section>
      ) : null}
      <span data-text-input>{value}</span>
      <span data-input-actions />
      {files.map((file) => (
        <div key={file.filePath}>
          {file.fileName}
          <button
            type="button"
            aria-label={`Remove ${file.fileName}`}
            onClick={() =>
              onFilesChange?.(
                files.filter((item) => item.filePath !== file.filePath)
              )
            }
          />
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/ChatBox/BottomBox/PickerPanel', () => ({
  ConnectorPickerPanel: () => <div />,
  SkillPickerPanel: () => <div />,
}));

const footerProps = {
  sessionMode: 'single-agent' as const,
};

describe('BottomBox structure', () => {
  it('keeps QueryBox above BoxMain and routes the legacy default to input', () => {
    const onFilesChange = vi.fn();
    const { container } = render(
      <BottomBox
        state="input"
        queuedMessages={[{ id: 'queued-1', content: 'Follow up' }]}
        inputProps={{
          value: 'Draft query',
          files: [{ fileName: 'brief.pdf', filePath: '/tmp/brief.pdf' }],
          onFilesChange,
        }}
        {...footerProps}
      />
    );

    const root = container.querySelector('[data-bottom-box]');
    const query = container.querySelector('[data-bottom-box-query]');
    const main = container.querySelector('[data-bottom-box-main]');
    const input = container.querySelector('[data-bottom-box-input]');
    const footer = container.querySelector('[data-bottom-box-footer]');

    expect(root).toBeInTheDocument();
    expect(query).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(root?.firstElementChild).toBe(query);
    expect(main).toContainElement(input);
    expect(main).toContainElement(footer);
    expect(input).toHaveAttribute('data-variant', 'input');
    expect(
      main?.querySelector(':scope > [data-bottom-box-header]')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('text-composer')).toHaveTextContent(
      'Draft query'
    );
    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('project-setup-footer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove brief.pdf' }));
    expect(onFilesChange).toHaveBeenCalledWith([]);
  });

  it('renders the composer question inside InputBox instead of BoxHeader', () => {
    const { container } = render(
      <BottomBox
        state="input"
        variant={{
          kind: 'input',
          header: {
            eyebrow: 'Input required',
            title: 'Which format should I use?',
          },
        }}
        inputProps={{ value: 'PDF' }}
        {...footerProps}
      />
    );

    const main = container.querySelector('[data-bottom-box-main]');
    const input = container.querySelector('[data-bottom-box-input]');
    const header = input?.querySelector('[data-bottom-box-header]');
    const surface = input?.querySelector('[data-bottom-box-input-surface]');
    const textInput = surface?.querySelector('[data-text-input]');
    const inputActions = surface?.querySelector('[data-input-actions]');

    expect(
      main?.querySelector(':scope > [data-bottom-box-header]')
    ).not.toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(surface).toContainElement(header as HTMLElement);
    expect(surface).toContainElement(textInput as HTMLElement);
    expect(surface).toContainElement(inputActions as HTMLElement);
    expect(header).toHaveTextContent('Input required');
    expect(header).toHaveTextContent('Which format should I use?');
  });

  it('routes a confirmation request and keeps the project footer mounted', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();

    const { container } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'confirmation',
          header: { title: 'Publish the report?' },
          confirmLabel: 'Publish',
          onConfirm,
          onReject,
        }}
        {...footerProps}
      />
    );

    expect(screen.getByText('Publish the report?')).toBeInTheDocument();
    expect(container.querySelector('[data-bottom-box-input]')).toHaveAttribute(
      'data-variant',
      'confirmation'
    );
    expect(screen.getByTestId('project-setup-footer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('renders only the approval scopes supplied by the owner', async () => {
    const onApprove = vi.fn();

    const { container } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'approval',
          header: {
            eyebrow: 'Permission required',
            title: 'Allow todo_write?',
            contextItems: [
              {
                id: 'agent',
                label: 'single_agent',
                kind: 'agent',
              },
              {
                id: 'operation',
                label: 'mcp.tool.write',
                kind: 'operation',
              },
              {
                id: 'resource',
                label: 'brave_search.web_search',
                kind: 'external-context',
              },
            ],
            details: [
              {
                id: 'arguments',
                label: 'Review arguments (secrets redacted)',
                content: '{\n  "item": "Write tests"\n}',
              },
            ],
          },
          options: [{ scope: 'once', label: 'Approve once' }],
          onApprove,
          onReject: vi.fn(),
        }}
        {...footerProps}
      />
    );

    expect(container.querySelector('[data-bottom-box-input]')).toHaveAttribute(
      'data-variant',
      'approval'
    );
    expect(container.querySelector('[data-bottom-box-footer]')).toBeNull();
    expect(screen.queryByTestId('project-setup-footer')).toBeNull();
    const approvalSurface = container.querySelector(
      '[data-approval-surface][data-bottom-box-input-surface]'
    );
    const approvalHeader = approvalSurface?.querySelector(
      '[data-bottom-box-header]'
    );
    const approvalActions = approvalSurface?.querySelector(
      '[data-approval-actions]'
    );

    expect(approvalSurface).toBeInTheDocument();
    expect(approvalHeader).toBeInTheDocument();
    expect(approvalHeader).not.toHaveTextContent('Permission required');
    expect(approvalHeader).toHaveTextContent('Allow todo_write?');
    expect(approvalSurface).toContainElement(approvalActions as HTMLElement);
    expect(container.querySelector('[data-approval-actions]')).toHaveClass(
      'justify-end'
    );
    const approvalButtons = within(approvalActions as HTMLElement).getAllByRole(
      'button'
    );
    expect(approvalButtons).toHaveLength(2);
    approvalButtons.forEach((button) =>
      expect(button).toHaveClass('!rounded-full')
    );
    expect(container.querySelector('p, h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /always allow/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Review arguments (secrets redacted)')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('single_agent')).not.toBeInTheDocument();
    expect(screen.queryByText('mcp.tool.write')).not.toBeInTheDocument();
    expect(
      screen.queryByText('brave_search.web_search')
    ).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reject' })).not.toHaveFocus()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(onApprove).toHaveBeenCalledWith('once');
  });

  it('renders a concise approval without eyebrow or scope descriptions', () => {
    render(
      <BottomBox
        state="running"
        variant={{
          kind: 'approval',
          header: {
            eyebrow: 'Input required',
            title: 'The agent wants to run send_message_to_user.',
          },
          options: [
            {
              scope: 'once',
              label: 'Approve once',
              description: 'Allow this action one time only.',
            },
            {
              scope: 'space',
              label: 'Always allow',
              description: 'Allow this action in this Space from now on.',
            },
          ],
          onApprove: vi.fn(),
          onReject: vi.fn(),
        }}
        {...footerProps}
      />
    );

    expect(screen.queryByText('Input required')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Allow this action one time only.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Allow this action in this Space from now on.')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Approve once' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Always allow' })
    ).toBeInTheDocument();
  });

  it('animates from the composer into a three-action approval variant', async () => {
    const { container, rerender } = render(
      <BottomBox
        state="input"
        inputProps={{ value: 'Draft query' }}
        {...footerProps}
      />
    );

    expect(
      container.querySelector(
        '[data-bottom-box-variant-transition][data-variant="input"]'
      )
    ).toBeInTheDocument();
    expect(container.querySelector('[data-bottom-box-main]')).toHaveAttribute(
      'data-layout-motion',
      'smooth'
    );

    rerender(
      <BottomBox
        state="running"
        variant={{
          kind: 'approval',
          header: {
            eyebrow: 'Input required',
            title: 'The agent wants to publish the report.',
          },
          options: [
            { scope: 'once', label: 'Approve once' },
            { scope: 'space', label: 'Always allow in Space' },
          ],
          onApprove: vi.fn(),
          onReject: vi.fn(),
        }}
        {...footerProps}
      />
    );

    expect(
      container.querySelector(
        '[data-bottom-box-variant-transition][data-variant="approval"]'
      )
    ).toBeInTheDocument();
    expect(container.querySelector('[data-bottom-box-footer]')).toBeNull();
    expect(screen.queryByTestId('project-setup-footer')).toBeNull();
    expect(container.querySelector('[data-bottom-box-main]')).toHaveAttribute(
      'data-layout-motion',
      'instant'
    );
    expect(screen.queryByText('Input required')).not.toBeInTheDocument();
    expect(
      screen.getByText('The agent wants to publish the report.')
    ).toBeInTheDocument();
    expect(
      within(
        container.querySelector('[data-approval-actions]') as HTMLElement
      ).getAllByRole('button')
    ).toHaveLength(3);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reject' })).not.toHaveFocus()
    );
  });

  it('routes controlled selection changes without owning event state', () => {
    const onSelectionChange = vi.fn();

    render(
      <BottomBox
        state="running"
        variant={{
          kind: 'selection',
          header: { title: 'Choose a format' },
          options: [
            { id: 'pdf', label: 'PDF' },
            { id: 'docx', label: 'Word document' },
          ],
          selectedIds: [],
          onSelectionChange,
          onSubmit: vi.fn(),
        }}
        {...footerProps}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'PDF' }));
    expect(onSelectionChange).toHaveBeenCalledWith(['pdf']);
  });

  it('keeps standard textarea chrome for non-question feedback', () => {
    render(
      <BottomBox
        state="running"
        variant={{
          kind: 'feedback',
          header: { title: 'Share feedback' },
          value: '',
          onChange: vi.fn(),
          onSubmit: vi.fn(),
        }}
        {...footerProps}
      />
    );

    expect(screen.getByRole('textbox', { name: 'Feedback' })).toHaveClass(
      'border',
      'shadow-sm',
      'focus-visible:ring-2'
    );
  });

  it('routes feedback and structured form callbacks', async () => {
    const onFeedbackChange = vi.fn();
    const onFieldChange = vi.fn();
    const { rerender } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'feedback',
          presentation: 'question',
          header: {
            title: 'Question',
            description: '### What should I **change**?',
          },
          value: '',
          onChange: onFeedbackChange,
          onSubmit: vi.fn(),
        }}
        {...footerProps}
      />
    );

    const questionLabel = screen.getByText('Question');
    expect(questionLabel.parentElement).toHaveClass(
      'text-ds-text-base',
      'font-bold'
    );
    expect(
      questionLabel
        .closest('[data-bottom-box-header]')
        ?.querySelector('[data-bottom-box-question-icon]')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        document.querySelector('[data-bottom-box-question-markdown] h3')
      ).toBeInTheDocument()
    );
    const questionPrompt = document.querySelector(
      '[data-bottom-box-question-markdown] h3'
    ) as HTMLElement;
    expect(questionPrompt).toHaveTextContent('What should I change?');
    expect(questionPrompt.querySelector('strong')).toHaveTextContent('change');
    expect(
      questionPrompt.closest('[data-bottom-box-question-markdown]')
    ).toHaveClass(
      'bottom-box-question-markdown',
      'text-ds-text-base',
      'text-ds-ink-default-default'
    );
    expect(
      questionPrompt.closest('[data-bottom-box-header]')
    ).toBeInTheDocument();
    const questionTextarea = screen.getByRole('textbox', {
      name: 'Feedback',
    });
    expect(questionTextarea).toHaveClass(
      'border-none',
      'shadow-none',
      'focus-visible:ring-0',
      'focus-visible:ring-offset-0'
    );
    fireEvent.change(questionTextarea, {
      target: { value: 'Use a shorter title' },
    });
    expect(onFeedbackChange).toHaveBeenCalledWith('Use a shorter title');

    rerender(
      <BottomBox
        state="running"
        variant={{
          kind: 'form',
          header: { title: 'Report details' },
          fields: [
            { id: 'audience', label: 'Audience', value: '', required: true },
          ],
          onFieldChange,
          onSubmit: vi.fn(),
        }}
        {...footerProps}
      />
    );

    const inputRegion = document.querySelector(
      '[data-bottom-box-input][data-variant="form"]'
    );
    expect(inputRegion).toBeInTheDocument();
    fireEvent.change(within(inputRegion as HTMLElement).getByRole('textbox'), {
      target: { value: 'Executives' },
    });
    expect(onFieldChange).toHaveBeenCalledWith('audience', 'Executives');
  });

  it('accepts every controlled variant without requiring composer props', () => {
    const variants: BottomBoxProps['variant'][] = [
      {
        kind: 'confirmation',
        header: {},
        onConfirm: vi.fn(),
        onReject: vi.fn(),
      },
      {
        kind: 'approval',
        header: {},
        options: [],
        onApprove: vi.fn(),
        onReject: vi.fn(),
      },
      {
        kind: 'selection',
        header: {},
        options: [],
        selectedIds: [],
        onSelectionChange: vi.fn(),
        onSubmit: vi.fn(),
      },
      {
        kind: 'feedback',
        header: {},
        value: '',
        onChange: vi.fn(),
        onSubmit: vi.fn(),
      },
      {
        kind: 'form',
        header: {},
        fields: [],
        onFieldChange: vi.fn(),
        onSubmit: vi.fn(),
      },
      {
        kind: 'blocked',
        header: { title: 'Unsupported request' },
        message: 'Update the app before responding.',
      },
      {
        kind: 'run_control',
        header: { title: 'Run controls' },
        runId: 'run-1',
        state: 'read_only',
      },
    ];

    expect(variants.map((variant) => variant?.kind)).toEqual([
      'confirmation',
      'approval',
      'selection',
      'feedback',
      'form',
      'blocked',
      'run_control',
    ]);
  });

  it('fails closed for a blocked mandatory interaction', () => {
    render(
      <BottomBox
        state="running"
        variant={{
          kind: 'blocked',
          header: { title: 'Unsupported request' },
          message: 'This decision cannot be submitted safely.',
        }}
        {...footerProps}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This decision cannot be submitted safely.'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-setup-footer')).toBeInTheDocument();
  });

  it('routes Resume and Cancel to the explicitly targeted interrupted Run', () => {
    const onResume = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'run_control',
          header: { title: 'Run interrupted' },
          runId: 'run-interrupted',
          state: 'interrupted',
          onResume,
          onCancel,
        }}
        {...footerProps}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    expect(onResume).toHaveBeenCalledWith('run-interrupted');
    expect(onCancel).toHaveBeenCalledWith('run-interrupted');

    rerender(
      <BottomBox
        state="running"
        variant={{
          kind: 'run_control',
          header: { title: 'Run interrupted' },
          runId: 'run-interrupted',
          state: 'interrupted',
          disabled: true,
          onResume,
          onCancel,
        }}
        {...footerProps}
      />
    );
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeDisabled();
  });

  it('shows locked transition labels and hides actions for read-only Runs', () => {
    const common = {
      kind: 'run_control' as const,
      header: { title: 'Run lifecycle' },
      runId: 'run-7',
    };
    const { rerender } = render(
      <BottomBox
        state="running"
        variant={{ ...common, state: 'resuming' }}
        {...footerProps}
      />
    );
    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeDisabled();

    rerender(
      <BottomBox
        state="running"
        variant={{ ...common, state: 'cancelling' }}
        {...footerProps}
      />
    );
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();

    rerender(
      <BottomBox
        state="running"
        variant={{ ...common, state: 'read_only' }}
        {...footerProps}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'This task has finished, so these controls are no longer available.'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
