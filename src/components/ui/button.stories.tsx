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
import { Download, Plus, Trash2 } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost'],
      description:
        'Component chrome pattern. Legacy one-word variants are still accepted for compatibility.',
    },
    emphasis: {
      control: 'select',
      options: ['subtle', 'muted', 'default', 'strong', 'inverse'],
      description: 'Visual intensity axis, independent from semantic tone.',
    },
    tone: {
      control: 'select',
      options: ['neutral', 'success', 'error', 'information', 'warning'],
      description: 'Semantic palette (pairs with variant).',
    },
    size: {
      control: 'select',
      options: ['xxs', 'xs', 'sm', 'md', 'lg', 'icon'],
    },
    buttonContent: {
      control: 'select',
      options: ['text', 'icon-only'],
    },
    textWeight: {
      control: 'select',
      options: ['normal', 'medium', 'semibold', 'bold'],
    },
    buttonRadius: {
      control: 'select',
      options: ['lg', 'full'],
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
    tone: 'neutral',
    size: 'md',
  },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Primary Button',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary Button',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline Button',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost Button',
  },
};

export const Inverse: Story = {
  args: {
    variant: 'primary',
    emphasis: 'inverse',
    children: 'Inverse (canvas + ink)',
  },
};

export const Success: Story = {
  args: {
    variant: 'primary',
    tone: 'success',
    children: 'Success Button',
  },
};

export const Warning: Story = {
  args: {
    variant: 'primary',
    tone: 'warning',
    children: 'Warning Button',
  },
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    children: 'Disabled Button',
    disabled: true,
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <Button {...args}>
      <Plus /> Add Item
    </Button>
  ),
  args: {
    variant: 'primary',
  },
};

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
};

export const AllVariants: Story = {
  render: () => (
    <div className="gap-6 flex flex-col">
      <div className="gap-4 flex flex-wrap items-center">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="primary" emphasis="inverse">
          Inverse
        </Button>
      </div>
      <div className="gap-4 flex flex-wrap items-center">
        <Button variant="primary" tone="success">
          Success
        </Button>
        <Button variant="primary" tone="error">
          Error
        </Button>
        <Button variant="primary" tone="information">
          Information
        </Button>
        <Button variant="primary" tone="warning">
          Warning
        </Button>
      </div>
      <div className="gap-4 flex flex-wrap items-center">
        <Button variant="primary" emphasis="subtle">
          Subtle
        </Button>
        <Button variant="primary" emphasis="muted">
          Muted
        </Button>
        <Button variant="primary" emphasis="default">
          Default
        </Button>
        <Button variant="primary" emphasis="strong">
          Strong
        </Button>
      </div>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="gap-4 flex flex-wrap items-center">
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
      <Button variant="primary" size="xs" buttonContent="icon-only">
        <Trash2 />
      </Button>
    </div>
  ),
};

// Interaction test stories
export const ClickInteraction: Story = {
  args: {
    variant: 'primary',
    children: 'Click Me',
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /click me/i });

    // Test that button is visible and enabled
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // Click the button
    await userEvent.click(button);

    // Verify the onClick handler was called
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const DisabledInteraction: Story = {
  args: {
    variant: 'primary',
    children: 'Disabled Button',
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /disabled button/i });

    // Test that button is visible but disabled
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();

    // Verify the onClick handler was NOT called (disabled buttons block pointer events)
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const HoverInteraction: Story = {
  args: {
    variant: 'outline',
    children: 'Hover Over Me',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /hover over me/i });

    // Test initial state
    await expect(button).toBeVisible();

    // Hover over the button
    await userEvent.hover(button);

    // The button should still be visible after hover
    await expect(button).toBeVisible();

    // Unhover
    await userEvent.unhover(button);
  },
};
