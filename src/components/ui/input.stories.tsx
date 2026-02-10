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

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  argTypes: {
    size: {
      control: 'select',
      options: ['default', 'sm'],
    },
    state: {
      control: 'select',
      options: ['default', 'hover', 'input', 'error', 'success', 'disabled'],
    },
    disabled: {
      control: 'boolean',
    },
    required: {
      control: 'boolean',
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithTitle: Story = {
  args: {
    title: 'Email Address',
    placeholder: 'name@example.com',
    type: 'email',
  },
};

export const Required: Story = {
  args: {
    title: 'Username',
    placeholder: 'Enter username',
    required: true,
  },
};

export const WithTooltip: Story = {
  args: {
    title: 'API Key',
    placeholder: 'Enter your API key',
    tooltip: 'Your API key can be found in your account settings',
  },
};

export const WithNote: Story = {
  args: {
    title: 'Password',
    type: 'password',
    placeholder: 'Enter password',
    note: 'Must be at least 8 characters',
  },
};

export const ErrorState: Story = {
  args: {
    title: 'Email',
    placeholder: 'name@example.com',
    state: 'error',
    note: 'Please enter a valid email address',
    defaultValue: 'invalid-email',
  },
};

export const SuccessState: Story = {
  args: {
    title: 'Username',
    placeholder: 'Enter username',
    state: 'success',
    note: 'Username is available',
    defaultValue: 'johndoe',
  },
};

export const Disabled: Story = {
  args: {
    title: 'Locked Field',
    placeholder: 'This field is disabled',
    disabled: true,
    defaultValue: 'Cannot edit',
  },
};

export const SmallSize: Story = {
  args: {
    size: 'sm',
    placeholder: 'Small input',
  },
};

export const WithLeadingIcon: Story = {
  args: {
    placeholder: 'Search...',
    leadingIcon: <Search size={16} />,
  },
};

export const WithBackIcon: Story = {
  render: function PasswordInput() {
    const [showPassword, setShowPassword] = useState(false);
    return (
      <Input
        title="Password"
        type={showPassword ? 'text' : 'password'}
        placeholder="Enter password"
        backIcon={showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        onBackIconClick={() => setShowPassword(!showPassword)}
      />
    );
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Input title="Default" state="default" placeholder="Default state" />
      <Input title="Hover" state="hover" placeholder="Hover state" />
      <Input title="Input" state="input" placeholder="Input state" />
      <Input
        title="Error"
        state="error"
        placeholder="Error state"
        note="Error message"
      />
      <Input
        title="Success"
        state="success"
        placeholder="Success state"
        note="Success message"
      />
      <Input title="Disabled" disabled placeholder="Disabled state" />
    </div>
  ),
};

export const FormExample: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-text-heading">Contact Form</h3>
      <Input title="Full Name" placeholder="John Doe" required />
      <Input
        title="Email"
        type="email"
        placeholder="john@example.com"
        required
      />
      <Input
        title="Phone"
        type="tel"
        placeholder="+1 (555) 123-4567"
        tooltip="We'll only use this for urgent matters"
      />
      <Input
        title="Message"
        placeholder="How can we help you?"
        note="Maximum 500 characters"
      />
    </div>
  ),
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

// Interaction test stories
export const TypeInteraction: Story = {
  args: {
    placeholder: 'Type something...',
    onChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Type something...');

    // Test that input is visible and enabled
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Clear any existing value and type new text
    await userEvent.clear(input);
    await userEvent.type(input, 'Hello World');

    // Verify the input value
    await expect(input).toHaveValue('Hello World');

    // Verify onChange was called
    await expect(args.onChange).toHaveBeenCalled();
  },
};

export const FocusInteraction: Story = {
  args: {
    title: 'Focus Test',
    placeholder: 'Click to focus...',
    onFocus: fn(),
    onBlur: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Click to focus...');

    // Click to focus the input
    await userEvent.click(input);
    await expect(args.onFocus).toHaveBeenCalled();

    // Tab away to blur
    await userEvent.tab();
    await expect(args.onBlur).toHaveBeenCalled();
  },
};

export const ClearAndTypeInteraction: Story = {
  args: {
    title: 'Edit Field',
    placeholder: 'Edit this text',
    defaultValue: 'Initial value',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Edit this text');

    // Verify initial value
    await expect(input).toHaveValue('Initial value');

    // Select all and replace
    await userEvent.tripleClick(input);
    await userEvent.type(input, 'Replaced text');

    // Verify the new value
    await expect(input).toHaveValue('Replaced text');
  },
};

export const PasswordToggleInteraction: Story = {
  render: function PasswordToggle() {
    const [showPassword, setShowPassword] = useState(false);
    return (
      <Input
        title="Password"
        type={showPassword ? 'text' : 'password'}
        placeholder="Enter password"
        defaultValue="secret123"
        backIcon={showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        onBackIconClick={() => setShowPassword(!showPassword)}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Enter password');
    const toggleButton = canvas.getByRole('button');

    // Initially password should be hidden (type="password")
    await expect(input).toHaveAttribute('type', 'password');

    // Click toggle to show password
    await userEvent.click(toggleButton);
    await expect(input).toHaveAttribute('type', 'text');

    // Click toggle again to hide password
    await userEvent.click(toggleButton);
    await expect(input).toHaveAttribute('type', 'password');
  },
};
