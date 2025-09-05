// Comprehensive unit tests for SearchInput component
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchInput from '../../../src/components/SearchInput/index'
import { useState } from 'react'

// Mock the Input component from ui (matching relative import in component)
vi.mock('../../../src/components/ui/input', () => ({
  Input: vi.fn().mockImplementation((props) => <input {...props} />)
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Search: vi.fn().mockImplementation((props) => <div data-testid="search-icon" {...props} />)
}))

describe('SearchInput Component', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Render', () => {
    it('should render input field', () => {
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should render with empty value initially', () => {
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })

    it('should render with provided value', () => {
      render(<SearchInput {...defaultProps} value="test search" />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('test search')
    })

    it('should render search icon', () => {
      render(<SearchInput {...defaultProps} />)
      
      const searchIcons = screen.getAllByTestId('search-icon')
      expect(searchIcons.length).toBeGreaterThan(0)
    })
  })

  describe('Placeholder Behavior', () => {
    it('should show placeholder when value is empty and not focused', () => {
      render(<SearchInput {...defaultProps} />)
      
      expect(screen.getByText('Search MCPs')).toBeInTheDocument()
    })

    it('should hide placeholder when input has value', () => {
      render(<SearchInput {...defaultProps} value="search term" />)
      
      expect(screen.queryByText('Search MCPs')).not.toBeInTheDocument()
    })

    it('should hide placeholder when input is focused', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      
      await waitFor(() => {
        expect(screen.queryByText('Search MCPs')).not.toBeInTheDocument()
      })
    })

    it('should show placeholder again when input loses focus and is empty', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      
      // Focus the input
      await user.click(input)
      
      // Blur the input
      await user.tab()
      
      await waitFor(() => {
        expect(screen.getByText('Search MCPs')).toBeInTheDocument()
      })
    })
  })

  describe('Focus States', () => {
    it('should handle focus event', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      
      expect(input).toHaveFocus()
    })

    it('should handle blur event', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      await user.tab()
      
      expect(input).not.toHaveFocus()
    })

    it('should change text alignment when focused', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      
      // Initially should have center alignment (when empty and not focused)
      expect(input).toHaveStyle({ textAlign: 'center' })
      
      // Focus the input
      await user.click(input)
      
      // Should have left alignment when focused
      expect(input).toHaveStyle({ textAlign: 'left' })
    })

    it('should change text alignment when has value', () => {
      render(<SearchInput {...defaultProps} value="test" />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveStyle({ textAlign: 'left' })
    })
  })

  describe('Input Handling', () => {
    it('should call onChange when input value changes', async () => {
      const user = userEvent.setup()
        // Use a controlled wrapper so typing updates the input's value reliably in tests
        const Controlled = () => {
          const [val, setVal] = useState('')
          return <SearchInput value={val} onChange={(e: any) => setVal(e.target.value)} />
        }

        render(<Controlled />)

        const input = screen.getByRole('textbox') as HTMLInputElement
        await user.type(input, 'test')

    // The DOM input should now contain 'test'
    expect(input.value).toBe('test')
    })

    it('should handle backspace correctly', async () => {
      const user = userEvent.setup()
      // Controlled instance to reflect backspace in DOM
      const Controlled = () => {
        const [val, setVal] = useState('test')
        return <SearchInput value={val} onChange={(e: any) => setVal(e.target.value)} />
      }

      render(<Controlled />)

      const input = screen.getByRole('textbox') as HTMLInputElement
      await user.click(input)
      await user.keyboard('{Backspace}')

  // The DOM input should have one less character
  expect(input.value).toBe('tes')
    })

    it('should handle clear input', async () => {
      const user = userEvent.setup()
      const Controlled = () => {
        const [val, setVal] = useState('test')
        return <SearchInput value={val} onChange={(e: any) => setVal(e.target.value)} />
      }

      render(<Controlled />)

      const input = screen.getByRole('textbox') as HTMLInputElement
      await user.clear(input)

  expect(input.value).toBe('')
    })
  })

  describe('Icon Positioning', () => {
    it('should position search icon in center when placeholder is shown', () => {
      render(<SearchInput {...defaultProps} />)
      
      const placeholderContainer = screen.getByText('Search MCPs').parentElement
      expect(placeholderContainer).toHaveClass('justify-center')
    })

    it('should position search icon on left when input has value', () => {
      render(<SearchInput {...defaultProps} value="test" />)
      
      // When value exists, the left-positioned icon should be visible
      const leftIcon = document.querySelector('.absolute.left-4')
      expect(leftIcon).toBeInTheDocument()
    })

    it('should position search icon on left when input is focused', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      
      await waitFor(() => {
        const leftIcon = document.querySelector('.absolute.left-4')
        expect(leftIcon).toBeInTheDocument()
      })
    })
  })

  describe('Styling and Classes', () => {
    it('should apply correct CSS classes to input', () => {
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass(
        'h-6',
        'pl-12',
        'pr-4',
        'py-2',
        'bg-bg-surface-tertiary',
        'rounded-[24px]',
        'border-none',
        'shadow-none',
        'focus-visible:ring-0',
        'focus-visible:ring-transparent',
        'focus-visible:border-none',
        'text-gray-900'
      )
    })

    it('should apply correct classes to container', () => {
      render(<SearchInput {...defaultProps} />)
      
      const container = screen.getByRole('textbox').parentElement
      expect(container).toHaveClass('relative', 'w-full')
    })

    it('should apply correct classes to placeholder', () => {
      render(<SearchInput {...defaultProps} />)
      
      const placeholder = screen.getByText('Search MCPs').parentElement
      expect(placeholder).toHaveClass(
        'pointer-events-none',
        'absolute',
        'inset-0',
        'flex',
        'items-center',
        'justify-center',
        'text-text-secondary',
        'select-none'
      )
    })

    it('should apply correct classes to search icon in placeholder', () => {
      render(<SearchInput {...defaultProps} />)
      
      const searchIcon = screen.getAllByTestId('search-icon')[0]
      expect(searchIcon).toHaveClass('w-4', 'h-4', 'mr-2', 'text-icon-secondary')
    })

    it('should apply correct classes to search text in placeholder', () => {
      render(<SearchInput {...defaultProps} />)
      
      const searchText = screen.getByText('Search MCPs')
      expect(searchText).toHaveClass('text-xs', 'leading-none', 'text-text-body')
    })
  })

  describe('Keyboard Navigation', () => {
    it('should handle Tab key for navigation', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <SearchInput {...defaultProps} />
          <button>Next Element</button>
        </div>
      )
      
      const input = screen.getByRole('textbox')
      const button = screen.getByRole('button')
      
      await user.click(input)
      expect(input).toHaveFocus()
      
      await user.tab()
      expect(button).toHaveFocus()
    })

    it('should handle Shift+Tab for reverse navigation', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <button>Previous Element</button>
          <SearchInput {...defaultProps} />
        </div>
      )
      
      const input = screen.getByRole('textbox')
      const button = screen.getByRole('button')
      
      await user.click(input)
      expect(input).toHaveFocus()
      
      await user.keyboard('{Shift>}{Tab}{/Shift}')
      expect(button).toHaveFocus()
    })

    it('should handle Enter key', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      
      render(<SearchInput value="test" onChange={mockOnChange} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      await user.keyboard('{Enter}')
      
      // Enter key should not change the value
      expect(mockOnChange).not.toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            value: expect.stringContaining('\n')
          })
        })
      )
    })

    it('should handle Escape key', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.click(input)
      
      expect(input).toHaveFocus()
      
      await user.keyboard('{Escape}')
      
      // Component doesn't implement Escape key handling, so focus remains
      // This is expected behavior for a simple search input
      expect(input).toHaveFocus()
    })
  })

  describe('Accessibility', () => {
    it('should have proper role attribute', () => {
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('should be focusable', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      await user.tab()
      
      expect(input).toHaveFocus()
    })

    it('should handle screen reader accessibility', () => {
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      
      // Should be accessible to screen readers
      expect(input).toBeVisible()
      expect(input).not.toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long input values', async () => {
      const user = userEvent.setup()
      const longValue = 'a'.repeat(1000)
      const mockOnChange = vi.fn()
      
      render(<SearchInput value="" onChange={mockOnChange} />)
      
      const input = screen.getByRole('textbox')
      await user.type(input, longValue)
      
      expect(mockOnChange).toHaveBeenCalledTimes(1000)
    })

    it('should handle special characters', async () => {
      const user = userEvent.setup()
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      const mockOnChange = vi.fn()
      
      render(<SearchInput value="" onChange={mockOnChange} />)
      
      const input = screen.getByRole('textbox')
      // Send each character as an input change to avoid user-event parsing of bracket sequences
      for (const ch of specialChars) {
        const newVal = (input as HTMLInputElement).value + ch
        fireEvent.change(input, { target: { value: newVal } })
      }

      expect(mockOnChange).toHaveBeenCalledTimes(specialChars.length)
    })

    it('should handle unicode characters', async () => {
      const user = userEvent.setup()
      const unicodeText = '测试 🚀 العربية'
      const mockOnChange = vi.fn()
      
      render(<SearchInput value="" onChange={mockOnChange} />)
      
      const input = screen.getByRole('textbox')
      await user.type(input, unicodeText)
      
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should handle rapid typing', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      
      render(<SearchInput value="" onChange={mockOnChange} />)
      
      const input = screen.getByRole('textbox')
      
      // Type multiple characters quickly
      await user.type(input, 'quick', { delay: 1 })
      
      expect(mockOnChange).toHaveBeenCalledTimes(5) // 'q', 'u', 'i', 'c', 'k'
    })
  })

  describe('Component State Management', () => {
    it('should maintain internal focus state correctly', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      
      // Initially not focused
      expect(screen.getByText('Search MCPs')).toBeInTheDocument()
      
      // Focus
      await user.click(input)
      expect(screen.queryByText('Search MCPs')).not.toBeInTheDocument()
      
      // Blur
      await user.tab()
      await waitFor(() => {
        expect(screen.getByText('Search MCPs')).toBeInTheDocument()
      })
    })

    it('should handle rapid focus/blur events', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)
      
      const input = screen.getByRole('textbox')
      
      // Rapid focus and blur
      await user.click(input)
      await user.tab()
      await user.click(input)
      await user.tab()
      
      // Should end up showing placeholder
      await waitFor(() => {
        expect(screen.getByText('Search MCPs')).toBeInTheDocument()
      })
    })
  })

  describe('Props Validation', () => {
    it('should handle missing onChange prop gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      expect(() => {
        render(<SearchInput value="" onChange={undefined as any} />)
      }).not.toThrow()
      
      consoleErrorSpy.mockRestore()
    })

    it('should handle null value prop', () => {
      render(<SearchInput value={null as any} onChange={vi.fn()} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })

    it('should handle undefined value prop', () => {
      render(<SearchInput value={undefined as any} onChange={vi.fn()} />)
      
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('')
    })
  })
})
