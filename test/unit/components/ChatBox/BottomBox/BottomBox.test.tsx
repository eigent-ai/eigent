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
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    <div data-testid="text-composer">
      {header && (header.eyebrow || header.title || header.description) ? (
        <section data-bottom-box-header>
          {header.eyebrow}
          {header.title}
          {header.description}
        </section>
      ) : null}
      {value}
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

    expect(
      main?.querySelector(':scope > [data-bottom-box-header]')
    ).not.toBeInTheDocument();
    expect(header).toBeInTheDocument();
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

  it('renders only the approval scopes supplied by the owner', () => {
    const onApprove = vi.fn();

    const { container } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'approval',
          header: {
            eyebrow: 'Permission required',
            title: 'Allow todo_write?',
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
    expect(
      screen.queryByRole('button', { name: /always allow/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Review arguments (secrets redacted)')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(onApprove).toHaveBeenCalledWith('once');
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

  it('routes feedback and structured form callbacks', () => {
    const onFeedbackChange = vi.fn();
    const onFieldChange = vi.fn();
    const { rerender } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'feedback',
          header: { title: 'What should I change?' },
          value: '',
          onChange: onFeedbackChange,
          onSubmit: vi.fn(),
        }}
        {...footerProps}
      />
    );

    expect(screen.getByText('What should I change?')).toBeInTheDocument();
    expect(
      screen
        .getByText('What should I change?')
        .closest('[data-bottom-box-header]')
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback' }), {
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

    const inputRegion = document.querySelector('[data-bottom-box-input]');
    expect(inputRegion).toHaveAttribute('data-variant', 'form');
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

  it('routes Stop to the explicitly targeted running Run', () => {
    const onStop = vi.fn();
    const { container } = render(
      <BottomBox
        state="running"
        variant={{
          kind: 'run_control',
          header: {
            eyebrow: 'Run control',
            title: 'Research Run',
            description: 'The Run is active.',
          },
          runId: 'run-42',
          state: 'running',
          onStop,
        }}
        {...footerProps}
      />
    );

    expect(screen.getByText('Research Run')).toBeInTheDocument();
    expect(container.querySelector('[data-bottom-box-input]')).toHaveAttribute(
      'data-variant',
      'run_control'
    );
    expect(container.querySelector('[data-run-control]')).toHaveAttribute(
      'data-run-id',
      'run-42'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith('run-42');
    expect(
      screen.queryByRole('button', { name: 'Resume' })
    ).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Run' }));
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
    expect(screen.getByRole('button', { name: 'Cancel Run' })).toBeDisabled();
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
        variant={{ ...common, state: 'stopping' }}
        {...footerProps}
      />
    );

    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();

    rerender(
      <BottomBox
        state="running"
        variant={{ ...common, state: 'resuming' }}
        {...footerProps}
      />
    );
    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel Run' })).toBeDisabled();

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
      'Run controls are unavailable in read-only mode.'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
