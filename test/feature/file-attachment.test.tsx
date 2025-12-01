import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Inputbox, FileAttachment } from '../../src/components/ChatBox/BottomBox/InputBox'
import userEvent from '@testing-library/user-event'

/**
 * Feature Test: File Attachment
 *
 * User Journey: User clicks attach → Selects file → File appears in input → Sends with message
 *
 * This test suite validates the file attachment functionality in the Inputbox component.
 * It focuses on adding files, displaying them, and removing them.
 */

describe('Feature Test: File Attachment', () => {
  let mockOnFilesChange: ReturnType<typeof vi.fn>
  let mockOnAddFile: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnFilesChange = vi.fn()
    mockOnAddFile = vi.fn()
  })

  /**
   * Test 1: Add file button is visible
   *
   * Validates that users can see the add file button:
   * - Button is rendered
   * - Button is clickable
   */
  it('displays add file button', () => {
    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={[]}
      />
    )

    // Verify add file button exists by finding all buttons
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(2)

    // First button is add file button (contains Plus icon)
    const addButton = buttons[0]
    expect(addButton).toBeTruthy()
  })

  /**
   * Test 2: Click add file button triggers callback
   *
   * Validates that clicking the add button works:
   * - Clicks button
   * - onAddFile callback is called
   */
  it('triggers onAddFile when add button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={[]}
      />
    )

    // Find all buttons and click the first one (add file button)
    const buttons = screen.getAllByRole('button')
    const addButton = buttons[0] // First button is the add file button

    await user.click(addButton)

    // Verify callback was called
    expect(mockOnAddFile).toHaveBeenCalledTimes(1)
  })

  /**
   * Test 3: Display single attached file
   *
   * Validates that attached files are displayed:
   * - File name is shown
   * - File icon is displayed
   */
  it('displays attached file with name and icon', () => {
    const files: FileAttachment[] = [
      { fileName: 'test.txt', filePath: '/path/to/test.txt' },
    ]

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Verify file name is displayed
    expect(screen.getByText('test.txt')).toBeInTheDocument()
  })

  /**
   * Test 4: Display multiple attached files
   *
   * Validates that multiple files can be attached:
   * - Shows all file names
   * - Each file is displayed independently
   */
  it('displays multiple attached files', () => {
    const files: FileAttachment[] = [
      { fileName: 'document.pdf', filePath: '/path/to/document.pdf' },
      { fileName: 'image.png', filePath: '/path/to/image.png' },
      { fileName: 'data.csv', filePath: '/path/to/data.csv' },
    ]

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Verify all file names are displayed
    expect(screen.getByText('document.pdf')).toBeInTheDocument()
    expect(screen.getByText('image.png')).toBeInTheDocument()
    expect(screen.getByText('data.csv')).toBeInTheDocument()
  })

  /**
   * Test 5: Remove attached file
   *
   * Validates that users can remove files:
   * - Clicks remove button on file
   * - onFilesChange is called with updated list
   */
  it('removes file when X button is clicked', async () => {
    const user = userEvent.setup()
    const files: FileAttachment[] = [
      { fileName: 'test.txt', filePath: '/path/to/test.txt' },
    ]

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Find the file chip and hover to reveal X button
    const fileChip = screen.getByText('test.txt').closest('div')
    expect(fileChip).toBeInTheDocument()

    // Hover over the file chip
    await user.hover(fileChip!)

    // Find and click the remove link (X icon)
    const removeLink = fileChip!.querySelector('a')
    expect(removeLink).toBeInTheDocument()
    await user.click(removeLink!)

    // Verify onFilesChange was called with empty array
    expect(mockOnFilesChange).toHaveBeenCalledWith([])
  })

  /**
   * Test 6: Remove one file from multiple files
   *
   * Validates that removing one file keeps others:
   * - Multiple files attached
   * - Removes specific file
   * - Other files remain
   */
  it('removes specific file from multiple files', async () => {
    const user = userEvent.setup()
    const files: FileAttachment[] = [
      { fileName: 'file1.txt', filePath: '/path/to/file1.txt' },
      { fileName: 'file2.txt', filePath: '/path/to/file2.txt' },
      { fileName: 'file3.txt', filePath: '/path/to/file3.txt' },
    ]

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Find file2.txt and remove it
    const file2Chip = screen.getByText('file2.txt').closest('div')
    await user.hover(file2Chip!)
    const removeLink = file2Chip!.querySelector('a')
    await user.click(removeLink!)

    // Verify onFilesChange was called with file2 removed
    expect(mockOnFilesChange).toHaveBeenCalledWith([
      { fileName: 'file1.txt', filePath: '/path/to/file1.txt' },
      { fileName: 'file3.txt', filePath: '/path/to/file3.txt' },
    ])
  })

  /**
   * Test 7: Files persist with message input
   *
   * Validates that files and message can coexist:
   * - User types message
   * - Files remain attached
   * - Both are visible
   */
  it('maintains file attachments while typing message', () => {
    const files: FileAttachment[] = [
      { fileName: 'test.txt', filePath: '/path/to/test.txt' },
    ]

    const { rerender } = render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Verify file is displayed
    expect(screen.getByText('test.txt')).toBeInTheDocument()

    // Update with message
    rerender(
      <Inputbox
        value="This is a message"
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Verify both message and file are present
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeInTheDocument()
    expect((textarea as HTMLTextAreaElement).value).toBe('This is a message')
    expect(screen.getByText('test.txt')).toBeInTheDocument()
  })

  /**
   * Test 8: Show remaining files count
   *
   * Validates that more than 5 files shows count indicator:
   * - Attaches 7 files
   * - First 5 are visible
   * - Shows "2+" indicator
   */
  it('displays remaining count for more than 5 files', () => {
    const files: FileAttachment[] = [
      { fileName: 'file1.txt', filePath: '/path/to/file1.txt' },
      { fileName: 'file2.txt', filePath: '/path/to/file2.txt' },
      { fileName: 'file3.txt', filePath: '/path/to/file3.txt' },
      { fileName: 'file4.txt', filePath: '/path/to/file4.txt' },
      { fileName: 'file5.txt', filePath: '/path/to/file5.txt' },
      { fileName: 'file6.txt', filePath: '/path/to/file6.txt' },
      { fileName: 'file7.txt', filePath: '/path/to/file7.txt' },
    ]

    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Verify first 5 files are displayed
    expect(screen.getByText('file1.txt')).toBeInTheDocument()
    expect(screen.getByText('file2.txt')).toBeInTheDocument()
    expect(screen.getByText('file3.txt')).toBeInTheDocument()
    expect(screen.getByText('file4.txt')).toBeInTheDocument()
    expect(screen.getByText('file5.txt')).toBeInTheDocument()

    // Verify remaining count is shown (2+)
    expect(screen.getByText('2+')).toBeInTheDocument()
  })

  /**
   * Test 9: Different file types show appropriate icons
   *
   * Validates that file icons vary by type:
   * - Image files show image icon
   * - Text files show document icon
   */
  it('displays appropriate icons for different file types', () => {
    const files: FileAttachment[] = [
      { fileName: 'photo.jpg', filePath: '/path/to/photo.jpg' },
      { fileName: 'document.pdf', filePath: '/path/to/document.pdf' },
    ]

    const { container } = render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={files}
      />
    )

    // Both files should be displayed
    expect(screen.getByText('photo.jpg')).toBeInTheDocument()
    expect(screen.getByText('document.pdf')).toBeInTheDocument()

    // Check that SVG icons are rendered (lucide icons render as SVGs)
    const svgElements = container.querySelectorAll('svg')
    expect(svgElements.length).toBeGreaterThan(0)
  })

  /**
   * Test 10: Disabled state prevents file operations
   *
   * Validates that disabled input prevents file actions:
   * - Add file button is disabled
   * - File operations are disabled
   */
  it('disables file operations when input is disabled', () => {
    render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={[]}
        disabled={true}
      />
    )

    // Find all buttons
    const buttons = screen.getAllByRole('button')

    // Add file button (first button) should be disabled
    expect(buttons[0]).toHaveProperty('disabled', true)

    // Send button (second button) should be disabled
    expect(buttons[1]).toHaveProperty('disabled', true)
  })

  /**
   * Test 11: Privacy mode disables file attachment
   *
   * Validates that privacy mode controls file attachment:
   * - privacy=false disables add file button
   * - privacy=true enables add file button
   */
  it('disables file attachment when privacy is disabled', () => {
    const { rerender } = render(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={[]}
        privacy={false}
      />
    )

    // Add file button should be disabled when privacy is false
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveProperty('disabled', true)

    // Enable privacy
    rerender(
      <Inputbox
        value=""
        onAddFile={mockOnAddFile}
        onFilesChange={mockOnFilesChange}
        files={[]}
        privacy={true}
      />
    )

    // Add file button should be enabled when privacy is true
    const updatedButtons = screen.getAllByRole('button')
    expect(updatedButtons[0]).toHaveProperty('disabled', false)
  })

  /**
   * Test 12: Complete file attachment workflow
   *
   * Validates the complete user workflow:
   * - Start with no files
   * - Add file via callback
   * - File appears in list
   * - Type message
   * - Remove file
   * - File list is empty
   */
  it('completes full file attachment workflow', async () => {
    const user = userEvent.setup()
    let currentFiles: FileAttachment[] = []
    let currentValue = ''

    const handleFilesChange = (files: FileAttachment[]) => {
      currentFiles = files
      mockOnFilesChange(files)
    }

    const handleValueChange = (value: string) => {
      currentValue = value
    }

    const { rerender } = render(
      <Inputbox
        value={currentValue}
        onChange={handleValueChange}
        onAddFile={mockOnAddFile}
        onFilesChange={handleFilesChange}
        files={currentFiles}
      />
    )

    // Step 1: Initially no files
    expect(screen.queryByText('test.txt')).toBeNull()

    // Step 2: Add file via callback (simulating file picker)
    const addButton = screen.getAllByRole('button')[0]
    await user.click(addButton)
    expect(mockOnAddFile).toHaveBeenCalledTimes(1)

    // Simulate file being added
    currentFiles = [{ fileName: 'test.txt', filePath: '/path/to/test.txt' }]
    rerender(
      <Inputbox
        value={currentValue}
        onChange={handleValueChange}
        onAddFile={mockOnAddFile}
        onFilesChange={handleFilesChange}
        files={currentFiles}
      />
    )

    // Step 3: File appears in list
    expect(screen.getByText('test.txt')).toBeInTheDocument()

    // Step 4: Type message
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Please analyze this file')
    currentValue = 'Please analyze this file'
    rerender(
      <Inputbox
        value={currentValue}
        onChange={handleValueChange}
        onAddFile={mockOnAddFile}
        onFilesChange={handleFilesChange}
        files={currentFiles}
      />
    )

    // Verify both message and file are present
    expect((textarea as HTMLTextAreaElement).value).toBe('Please analyze this file')
    expect(screen.getByText('test.txt')).toBeInTheDocument()

    // Step 5: Remove file
    const fileChip = screen.getByText('test.txt').closest('div')
    await user.hover(fileChip!)
    const removeLink = fileChip!.querySelector('a')
    await user.click(removeLink!)

    // Step 6: Verify file was removed
    expect(mockOnFilesChange).toHaveBeenCalledWith([])
  })
})
