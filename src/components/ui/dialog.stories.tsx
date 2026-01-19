import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogContentSection,
  DialogFooter,
} from './dialog'
import { Button } from './button'
import { Input } from './input'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
}

export default meta

type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: function DefaultDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader title="Dialog Title" subtitle="Optional subtitle text" />
          <DialogContentSection>
            <p className="text-text-body">
              This is the main content area of the dialog. You can add any content
              here including forms, text, images, or other components.
            </p>
          </DialogContentSection>
          <DialogFooter
            showCancelButton
            showConfirmButton
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              console.log('Confirmed!')
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const SmallSize: Story = {
  render: function SmallDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">Small Dialog</Button>
        </DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader title="Small Dialog" />
          <DialogContentSection>
            <p className="text-text-body">A compact dialog for simple actions.</p>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            confirmButtonText="OK"
            onConfirm={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const LargeSize: Story = {
  render: function LargeDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">Large Dialog</Button>
        </DialogTrigger>
        <DialogContent size="lg">
          <DialogHeader
            title="Large Dialog"
            subtitle="This dialog is wider for more complex content"
          />
          <DialogContentSection>
            <p className="text-text-body">
              Large dialogs are useful when you need to display more content, such
              as detailed forms, tables, or multi-step processes.
            </p>
          </DialogContentSection>
          <DialogFooter
            showCancelButton
            showConfirmButton
            onCancel={() => setOpen(false)}
            onConfirm={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const WithForm: Story = {
  render: function FormDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">Create Account</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader
            title="Create Account"
            subtitle="Enter your details to create a new account"
          />
          <DialogContentSection>
            <div className="flex flex-col gap-4">
              <Input title="Full Name" placeholder="Enter your full name" required />
              <Input
                title="Email"
                type="email"
                placeholder="name@example.com"
                required
              />
              <Input
                title="Password"
                type="password"
                placeholder="Create a password"
                required
                note="Must be at least 8 characters"
              />
            </div>
          </DialogContentSection>
          <DialogFooter
            showCancelButton
            showConfirmButton
            confirmButtonText="Create Account"
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              console.log('Account created!')
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const WithTooltip: Story = {
  render: function TooltipDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">With Tooltip</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader
            title="Settings"
            tooltip="Configure your application settings"
            showTooltip
          />
          <DialogContentSection>
            <p className="text-text-body">
              Hover over the icon next to the title to see the tooltip.
            </p>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            confirmButtonText="Save"
            onConfirm={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const WithBackButton: Story = {
  render: function BackButtonDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">Multi-step Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader
            title="Step 2 of 3"
            subtitle="Configure your preferences"
            showBackButton
            onBackClick={() => console.log('Back clicked')}
          />
          <DialogContentSection>
            <p className="text-text-body">
              Click the back button to return to the previous step.
            </p>
          </DialogContentSection>
          <DialogFooter
            showCancelButton
            showConfirmButton
            cancelButtonText="Back"
            confirmButtonText="Next"
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              console.log('Next step')
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const DestructiveAction: Story = {
  render: function DestructiveDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="warning">Delete Item</Button>
        </DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete Item"
            subtitle="This action cannot be undone"
          />
          <DialogContentSection>
            <p className="text-text-body">
              Are you sure you want to delete this item? All associated data will
              be permanently removed.
            </p>
          </DialogContentSection>
          <DialogFooter
            showCancelButton
            showConfirmButton
            confirmButtonText="Delete"
            confirmButtonVariant="warning"
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              console.log('Item deleted!')
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const NoCloseButton: Story = {
  render: function NoCloseDialog() {
    const [open, setOpen] = useState(false)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="primary">No Close Button</Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogHeader title="Required Action" />
          <DialogContentSection>
            <p className="text-text-body">
              This dialog does not have a close button. User must interact with
              the footer buttons.
            </p>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            confirmButtonText="Acknowledge"
            onConfirm={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    )
  },
}

export const AllSizes: Story = {
  render: function AllSizesDialog() {
    const [openSm, setOpenSm] = useState(false)
    const [openMd, setOpenMd] = useState(false)
    const [openLg, setOpenLg] = useState(false)
    return (
      <div className="flex gap-4">
        <Dialog open={openSm} onOpenChange={setOpenSm}>
          <DialogTrigger asChild>
            <Button variant="outline">Small (400px)</Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader title="Small Dialog" />
            <DialogContentSection>
              <p className="text-text-body">Max width: 400px</p>
            </DialogContentSection>
            <DialogFooter
              showConfirmButton
              confirmButtonText="Close"
              onConfirm={() => setOpenSm(false)}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={openMd} onOpenChange={setOpenMd}>
          <DialogTrigger asChild>
            <Button variant="outline">Medium (600px)</Button>
          </DialogTrigger>
          <DialogContent size="md">
            <DialogHeader title="Medium Dialog" />
            <DialogContentSection>
              <p className="text-text-body">Max width: 600px (default)</p>
            </DialogContentSection>
            <DialogFooter
              showConfirmButton
              confirmButtonText="Close"
              onConfirm={() => setOpenMd(false)}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={openLg} onOpenChange={setOpenLg}>
          <DialogTrigger asChild>
            <Button variant="outline">Large (900px)</Button>
          </DialogTrigger>
          <DialogContent size="lg">
            <DialogHeader title="Large Dialog" />
            <DialogContentSection>
              <p className="text-text-body">Max width: 900px</p>
            </DialogContentSection>
            <DialogFooter
              showConfirmButton
              confirmButtonText="Close"
              onConfirm={() => setOpenLg(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    )
  },
}
