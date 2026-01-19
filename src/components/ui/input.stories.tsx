import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input } from './input'
import { Search, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
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
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
}

export const WithTitle: Story = {
  args: {
    title: 'Email Address',
    placeholder: 'name@example.com',
    type: 'email',
  },
}

export const Required: Story = {
  args: {
    title: 'Username',
    placeholder: 'Enter username',
    required: true,
  },
}

export const WithTooltip: Story = {
  args: {
    title: 'API Key',
    placeholder: 'Enter your API key',
    tooltip: 'Your API key can be found in your account settings',
  },
}

export const WithNote: Story = {
  args: {
    title: 'Password',
    type: 'password',
    placeholder: 'Enter password',
    note: 'Must be at least 8 characters',
  },
}

export const ErrorState: Story = {
  args: {
    title: 'Email',
    placeholder: 'name@example.com',
    state: 'error',
    note: 'Please enter a valid email address',
    defaultValue: 'invalid-email',
  },
}

export const SuccessState: Story = {
  args: {
    title: 'Username',
    placeholder: 'Enter username',
    state: 'success',
    note: 'Username is available',
    defaultValue: 'johndoe',
  },
}

export const Disabled: Story = {
  args: {
    title: 'Locked Field',
    placeholder: 'This field is disabled',
    disabled: true,
    defaultValue: 'Cannot edit',
  },
}

export const SmallSize: Story = {
  args: {
    size: 'sm',
    placeholder: 'Small input',
  },
}

export const WithLeadingIcon: Story = {
  args: {
    placeholder: 'Search...',
    leadingIcon: <Search size={16} />,
  },
}

export const WithBackIcon: Story = {
  render: function PasswordInput() {
    const [showPassword, setShowPassword] = useState(false)
    return (
      <Input
        title="Password"
        type={showPassword ? 'text' : 'password'}
        placeholder="Enter password"
        backIcon={showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        onBackIconClick={() => setShowPassword(!showPassword)}
      />
    )
  },
}

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
}

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
}
