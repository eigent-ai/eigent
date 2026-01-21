import type { Preview } from '@storybook/react-vite'
import React from 'react'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '../src/style/index.css'
import './storybook.css' // Storybook-specific overrides
import { Toaster } from 'sonner'

// Apply theme immediately via script
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', 'light')
  document.documentElement.classList.add('root')
}

const preview: Preview = {
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f5f5f5' },
        { name: 'dark', value: '#1d1c1b' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <div className="root" data-theme="light" style={{ padding: '1rem' }}>
        <Story />
        <Toaster style={{ zIndex: '999999 !important', position: 'fixed' }} />
      </div>
    ),
  ],
}

export default preview
