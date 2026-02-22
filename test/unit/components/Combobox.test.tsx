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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Combobox } from '../../../src/components/ui/combobox';

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Loader2: () => <span data-testid="loader2" />,
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandInput: ({ placeholder, value, onValueChange }: any) => (
    <input
      data-testid="command-input"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: ({ children }: any) => (
    <div data-testid="command-empty">{children}</div>
  ),
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: any) => (
    <div data-testid="command-item" onClick={onSelect}>
      {children}
    </div>
  ),
}));

const OPTIONS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
];

describe('Combobox', () => {
  const onValueChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows placeholder when no value', () => {
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        placeholder="Pick a model"
      />
    );
    expect(screen.getByText('Pick a model')).toBeInTheDocument();
  });

  it('shows the raw value when it does not match any option', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="custom-model"
        onValueChange={onValueChange}
      />
    );
    expect(screen.getByText('custom-model')).toBeInTheDocument();
  });

  it('shows the option label when value matches', () => {
    render(
      <Combobox
        options={OPTIONS}
        value="gpt-4o"
        onValueChange={onValueChange}
      />
    );
    // Label appears in both the trigger and the option list — check the trigger
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('GPT-4o');
  });

  it('shows spinner when loading=true', () => {
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        loading
      />
    );
    expect(screen.getByTestId('loader2')).toBeInTheDocument();
    expect(screen.queryByTestId('chevron-down')).not.toBeInTheDocument();
  });

  it('shows chevron when loading=false', () => {
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        loading={false}
      />
    );
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.queryByTestId('loader2')).not.toBeInTheDocument();
  });

  it('shows emptyText in CommandEmpty', () => {
    render(
      <Combobox
        options={[]}
        value=""
        onValueChange={onValueChange}
        emptyText="No results"
      />
    );
    expect(screen.getByTestId('command-empty')).toHaveTextContent('No results');
  });

  it('shows note text when provided', () => {
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        note="Invalid model"
      />
    );
    expect(screen.getByText('Invalid model')).toBeInTheDocument();
  });

  it('does not render note element when note is not provided', () => {
    const { container } = render(
      <Combobox options={OPTIONS} value="" onValueChange={onValueChange} />
    );
    expect(container.querySelector('[class*="mt-1"]')).not.toBeInTheDocument();
  });

  it('renders all options', () => {
    render(
      <Combobox options={OPTIONS} value="" onValueChange={onValueChange} />
    );
    const items = screen.getAllByTestId('command-item');
    expect(items).toHaveLength(OPTIONS.length);
  });

  it('calls onValueChange when an option is selected', async () => {
    render(
      <Combobox options={OPTIONS} value="" onValueChange={onValueChange} />
    );
    const items = screen.getAllByTestId('command-item');
    await userEvent.click(items[0]);
    expect(onValueChange).toHaveBeenCalledWith('gpt-4o');
  });

  it('renders title when provided', () => {
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        title="Model Type"
      />
    );
    expect(screen.getByText('Model Type')).toBeInTheDocument();
  });
});
