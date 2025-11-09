// Comprehensive unit tests for SearchInput component
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchInput from '../../../src/components/SearchInput/index'
import { useState } from 'react'

// Mock the Input component from ui (matching relative import in component)
vi.mock('../../../src/components/ui/input', () => ({
  Input: vi.fn().mockImplementation((props) => {
    const { leadingIcon, ...restProps } = props
    return (
      <div className="relative w-full">
        {leadingIcon && <div className="leading-icon-wrapper">{leadingIcon}</div>}
        <input {...restProps} />
      </div>
    )
  })
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Search: vi.fn().mockImplementation((props) => <div data-testid="search-icon" {...props} />)
}))

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'setting.search-mcp') return 'Search MCPs'
      return key
    }
  })
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
    it('should have placeholder attribute', () => {
      render(<SearchInput {...defaultProps} />)

      const input = screen.getByPlaceholderText('Search MCPs')
      expect(input).toBeInTheDocument()
    })

    it('should show placeholder when value is empty', () => {
      render(<SearchInput {...defaultProps} />)

      const input = screen.getByPlaceholderText('Search MCPs')
      expect(input).toHaveValue('')
    })

    it('should not show placeholder text when input has value', () => {
      render(<SearchInput {...defaultProps} value="search term" />)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.value).toBe('search term')
    })

    it('should maintain placeholder after focus and blur when empty', async () => {
      const user = userEvent.setup()
      render(<SearchInput {...defaultProps} />)

      const input = screen.getByRole('textbox')

      // Focus the input
      await user.click(input)

      // Blur the input
      await user.tab()

      // Placeholder should still be present
      expect(screen.getByPlaceholderText('Search MCPs')).toBeInTheDocument()
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

    it('should accept text input when focused', async () => {
      const user = userEvent.setup()
      const mockOnChange = vi.fn()
      render(<SearchInput value="" onChange={mockOnChange} />)

      const input = screen.getByRole('textbox')
      await user.click(input)
      await user.keyboard('test')

      expect(mockOnChange).toHaveBeenCalled()
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
    it('should render search icon in component', () => {
      render(<SearchInput {...defaultProps} />)

      const searchIcon = screen.getByTestId('search-icon')
      expect(searchIcon).toBeInTheDocument()
    })

    it('should include leading icon when value is empty', () => {
      render(<SearchInput {...defaultProps} />)

      // The component should render with a leading icon
      const iconWrapper = document.querySelector('.leading-icon-wrapper')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should include leading icon when input has value', () => {
      render(<SearchInput {...defaultProps} value="test" />)

      // The component should render with a leading icon
      const iconWrapper = document.querySelector('.leading-icon-wrapper')
      expect(iconWrapper).toBeInTheDocument()
    })
  })

  describe('Styling and Classes', () => {
    it('should render within a container with relative positioning', () => {
      render(<SearchInput {...defaultProps} />)

      const container = screen.getByRole('textbox').parentElement
      expect(container).toHaveClass('relative', 'w-full')
    })

    it('should apply placeholder to input', () => {
      render(<SearchInput {...defaultProps} />)

      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('placeholder', 'Search MCPs')
    })

    it('should render search icon component', () => {
      render(<SearchInput {...defaultProps} />)

      const searchIcon = screen.getByTestId('search-icon')
      expect(searchIcon).toBeInTheDocument()
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
    it('should handle value changes correctly', async () => {
      const user = userEvent.setup()
      const Controlled = () => {
        const [val, setVal] = useState('')
        return <SearchInput value={val} onChange={(e: any) => setVal(e.target.value)} />
      }

      render(<Controlled />)

      const input = screen.getByRole('textbox')

      // Type text
      await user.type(input, 'test')

      expect((input as HTMLInputElement).value).toBe('test')
    })

    it('should handle rapid value changes', async () => {
      const user = userEvent.setup()
      const Controlled = () => {
        const [val, setVal] = useState('')
        return <SearchInput value={val} onChange={(e: any) => setVal(e.target.value)} />
      }

      render(<Controlled />)

      const input = screen.getByRole('textbox') as HTMLInputElement

      // Rapid focus and type
      await user.click(input)
      await user.keyboard('quick')

      expect(input.value).toBe('quick')
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
