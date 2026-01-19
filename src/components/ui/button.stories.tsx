import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { Plus, Download, Trash2 } from 'lucide-react'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'primary',
        'secondary',
        'outline',
        'ghost',
        'success',
        'cuation',
        'information',
        'warning',
      ],
    },
    size: {
      control: 'select',
      options: ['xxs', 'xs', 'sm', 'md', 'lg', 'icon'],
    },
    disabled: {
      control: 'boolean',
    },
    asChild: {
      control: 'boolean',
    },
    children: {
      control: 'text',
    },
  },
  args: {
    children: 'Button',
    variant: 'primary',
    size: 'md',
  },
  parameters: {
    layout: 'centered',
  },
}

export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Primary Button',
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary Button',
  },
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline Button',
  },
}

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost Button',
  },
}

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Success Button',
  },
}

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Warning Button',
  },
}

export const Disabled: Story = {
  args: {
    variant: 'primary',
    children: 'Disabled Button',
    disabled: true,
  },
}

export const WithIcon: Story = {
  render: (args) => (
    <Button {...args}>
      <Plus /> Add Item
    </Button>
  ),
  args: {
    variant: 'primary',
  },
}

export const IconOnly: Story = {
  render: (args) => (
    <Button {...args}>
      <Download />
    </Button>
  ),
  args: {
    variant: 'ghost',
    size: 'icon',
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="success">Success</Button>
      <Button variant="warning">Warning</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="primary" size="xxs">
        XXS
      </Button>
      <Button variant="primary" size="xs">
        XS
      </Button>
      <Button variant="primary" size="sm">
        SM
      </Button>
      <Button variant="primary" size="md">
        MD
      </Button>
      <Button variant="primary" size="lg">
        LG
      </Button>
      <Button variant="primary" size="icon">
        <Trash2 />
      </Button>
    </div>
  ),
}
