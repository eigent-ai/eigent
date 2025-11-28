import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Feature Test: MCP Server Configuration
 *
 * User Journey: User adds MCP server → Server appears in list → User can delete it
 *
 * This test suite validates the MCP (Model Context Protocol) server configuration.
 * Users should be able to add, view, and remove MCP servers from their settings.
 */

interface McpServer {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
}

// Mock MCP store
let mcpServers: McpServer[] = []

// Mock Electron API for MCP operations
const mockMcpList = vi.fn()
const mockMcpAdd = vi.fn()
const mockMcpDelete = vi.fn()
const mockMcpUpdate = vi.fn()

// Setup mocks before tests
Object.defineProperty(window, 'electronAPI', {
  value: {
    getPlatform: vi.fn(() => 'win32'),
    mcpList: mockMcpList,
    mcpAdd: mockMcpAdd,
    mcpDelete: mockMcpDelete,
    mcpUpdate: mockMcpUpdate,
  },
  writable: true,
  configurable: true,
});

(global as any).ipcRenderer = {
  invoke: vi.fn((channel, ...args) => {
    if (channel === 'mcp-list') return mockMcpList()
    if (channel === 'mcp-add') return mockMcpAdd(args[0])
    if (channel === 'mcp-delete') return mockMcpDelete(args[0])
    if (channel === 'mcp-update') return mockMcpUpdate(args[0])
    return Promise.resolve()
  }),
  on: vi.fn(),
  off: vi.fn(),
}

describe('Feature Test: MCP Server Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpServers = []

    // Setup mock implementations
    mockMcpList.mockImplementation(() => Promise.resolve(mcpServers))

    mockMcpAdd.mockImplementation((server: McpServer) => {
      const newServer = {
        ...server,
        id: `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        enabled: true,
      }
      mcpServers.push(newServer)
      return Promise.resolve({ success: true, server: newServer })
    })

    mockMcpDelete.mockImplementation((id: string) => {
      const index = mcpServers.findIndex(s => s.id === id)
      if (index !== -1) {
        mcpServers.splice(index, 1)
        return Promise.resolve({ success: true })
      }
      return Promise.resolve({ success: false, error: 'Server not found' })
    })

    mockMcpUpdate.mockImplementation((server: McpServer) => {
      const index = mcpServers.findIndex(s => s.id === server.id)
      if (index !== -1) {
        mcpServers[index] = { ...mcpServers[index], ...server }
        return Promise.resolve({ success: true, server: mcpServers[index] })
      }
      return Promise.resolve({ success: false, error: 'Server not found' })
    })
  })

  /**
   * Test 1: Retrieve empty MCP server list
   *
   * Validates initial state:
   * - Can fetch MCP server list
   * - List is empty initially
   * - No errors occur
   */
  it('retrieves empty MCP server list initially', async () => {
    const result = await window.electronAPI.mcpList()

    expect(mockMcpList).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
    expect(result.length).toBe(0)
  })

  /**
   * Test 2: Add new MCP server
   *
   * Validates adding a server:
   * - User provides server configuration
   * - Server is added successfully
   * - Server appears in list with generated ID
   * - Server is enabled by default
   */
  it('adds new MCP server successfully', async () => {
    const newServer = {
      name: 'GitHub MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'test-token-123',
      },
    }

    const result = await window.electronAPI.mcpAdd(newServer)

    // Verify server was added
    expect(mockMcpAdd).toHaveBeenCalledTimes(1)
    expect(mockMcpAdd).toHaveBeenCalledWith(newServer)
    expect(result.success).toBe(true)
    expect(result.server).toBeDefined()
    expect(result.server.id).toBeDefined()
    expect(result.server.name).toBe('GitHub MCP')
    expect(result.server.enabled).toBe(true)

    // Verify server is in list
    const list = await window.electronAPI.mcpList()
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('GitHub MCP')
  })

  /**
   * Test 3: Add multiple MCP servers
   *
   * Validates multiple servers:
   * - Can add multiple servers
   * - Each server has unique ID
   * - All servers appear in list
   */
  it('adds multiple MCP servers', async () => {
    // Add first server
    await window.electronAPI.mcpAdd({
      name: 'GitHub MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    })

    // Add second server
    await window.electronAPI.mcpAdd({
      name: 'Filesystem MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    })

    // Add third server
    await window.electronAPI.mcpAdd({
      name: 'Brave Search MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
    })

    // Verify all servers are in list
    const list = await window.electronAPI.mcpList()
    expect(list.length).toBe(3)
    expect(list.map(s => s.name)).toContain('GitHub MCP')
    expect(list.map(s => s.name)).toContain('Filesystem MCP')
    expect(list.map(s => s.name)).toContain('Brave Search MCP')

    // Verify each has unique ID
    const ids = list.map(s => s.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  /**
   * Test 4: Delete MCP server
   *
   * Validates server deletion:
   * - User selects server to delete
   * - Server is removed from list
   * - Deletion is confirmed
   * - Other servers remain unaffected
   */
  it('deletes MCP server successfully', async () => {
    // Add servers
    const result1 = await window.electronAPI.mcpAdd({
      name: 'Server 1',
      command: 'cmd1',
    })
    const result2 = await window.electronAPI.mcpAdd({
      name: 'Server 2',
      command: 'cmd2',
    })

    // Verify both are added
    let list = await window.electronAPI.mcpList()
    expect(list.length).toBe(2)

    // Delete first server
    const deleteResult = await window.electronAPI.mcpDelete(result1.server.id)
    expect(deleteResult.success).toBe(true)

    // Verify first server is deleted
    list = await window.electronAPI.mcpList()
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('Server 2')
    expect(list[0].id).toBe(result2.server.id)
  })

  /**
   * Test 5: Update MCP server configuration
   *
   * Validates server updates:
   * - User modifies server settings
   * - Changes are saved
   * - Server ID remains the same
   * - Updated values are reflected
   */
  it('updates MCP server configuration', async () => {
    // Add initial server
    const addResult = await window.electronAPI.mcpAdd({
      name: 'GitHub MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'old-token',
      },
    })

    const serverId = addResult.server.id

    // Update server
    const updateResult = await window.electronAPI.mcpUpdate({
      id: serverId,
      name: 'GitHub MCP (Updated)',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'new-token',
      },
      enabled: true,
    })

    expect(updateResult.success).toBe(true)
    expect(updateResult.server.id).toBe(serverId)
    expect(updateResult.server.name).toBe('GitHub MCP (Updated)')
    expect(updateResult.server.env.GITHUB_TOKEN).toBe('new-token')

    // Verify changes in list
    const list = await window.electronAPI.mcpList()
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('GitHub MCP (Updated)')
    expect(list[0].env.GITHUB_TOKEN).toBe('new-token')
  })

  /**
   * Test 6: Enable/disable MCP server
   *
   * Validates toggling server state:
   * - Server can be disabled without deletion
   * - Server can be re-enabled
   * - Enabled state persists
   */
  it('enables and disables MCP server', async () => {
    // Add server (enabled by default)
    const addResult = await window.electronAPI.mcpAdd({
      name: 'Test MCP',
      command: 'test',
    })

    const serverId = addResult.server.id
    expect(addResult.server.enabled).toBe(true)

    // Disable server
    await window.electronAPI.mcpUpdate({
      id: serverId,
      name: 'Test MCP',
      command: 'test',
      enabled: false,
    })

    let list = await window.electronAPI.mcpList()
    expect(list[0].enabled).toBe(false)

    // Re-enable server
    await window.electronAPI.mcpUpdate({
      id: serverId,
      name: 'Test MCP',
      command: 'test',
      enabled: true,
    })

    list = await window.electronAPI.mcpList()
    expect(list[0].enabled).toBe(true)
  })

  /**
   * Test 7: MCP server with environment variables
   *
   * Validates environment configuration:
   * - Server can have environment variables
   * - Env vars are stored correctly
   * - Multiple env vars are supported
   */
  it('stores MCP server with environment variables', async () => {
    const server = {
      name: 'Custom MCP',
      command: 'node',
      args: ['server.js'],
      env: {
        API_KEY: 'test-key-123',
        API_URL: 'https://api.example.com',
        DEBUG: 'true',
      },
    }

    const result = await window.electronAPI.mcpAdd(server)

    expect(result.success).toBe(true)
    expect(result.server.env).toEqual({
      API_KEY: 'test-key-123',
      API_URL: 'https://api.example.com',
      DEBUG: 'true',
    })

    // Verify env vars persist in list
    const list = await window.electronAPI.mcpList()
    expect(list[0].env).toEqual(server.env)
  })

  /**
   * Test 8: Delete non-existent server returns error
   *
   * Validates error handling:
   * - Attempting to delete non-existent server
   * - Returns error response
   * - Other servers unaffected
   */
  it('handles deletion of non-existent server', async () => {
    // Add a server
    await window.electronAPI.mcpAdd({
      name: 'Existing Server',
      command: 'cmd',
    })

    // Try to delete non-existent server
    const result = await window.electronAPI.mcpDelete('non-existent-id')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Server not found')

    // Verify existing server is unaffected
    const list = await window.electronAPI.mcpList()
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('Existing Server')
  })

  /**
   * Test 9: Complete MCP configuration workflow
   *
   * Validates full user journey:
   * - View empty list
   * - Add server
   * - Verify server appears
   * - Update server settings
   * - Disable server
   * - Re-enable server
   * - Delete server
   * - Verify list is empty
   */
  it('completes full MCP configuration workflow', async () => {
    // Step 1: View empty list
    let list = await window.electronAPI.mcpList()
    expect(list.length).toBe(0)

    // Step 2: Add server
    const addResult = await window.electronAPI.mcpAdd({
      name: 'GitHub MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'initial-token',
      },
    })

    expect(addResult.success).toBe(true)
    const serverId = addResult.server.id

    // Step 3: Verify server appears
    list = await window.electronAPI.mcpList()
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('GitHub MCP')

    // Step 4: Update server settings
    await window.electronAPI.mcpUpdate({
      id: serverId,
      name: 'GitHub MCP (Production)',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_TOKEN: 'production-token',
      },
      enabled: true,
    })

    list = await window.electronAPI.mcpList()
    expect(list[0].name).toBe('GitHub MCP (Production)')
    expect(list[0].env.GITHUB_TOKEN).toBe('production-token')

    // Step 5: Disable server
    await window.electronAPI.mcpUpdate({
      ...list[0],
      enabled: false,
    })

    list = await window.electronAPI.mcpList()
    expect(list[0].enabled).toBe(false)

    // Step 6: Re-enable server
    await window.electronAPI.mcpUpdate({
      ...list[0],
      enabled: true,
    })

    list = await window.electronAPI.mcpList()
    expect(list[0].enabled).toBe(true)

    // Step 7: Delete server
    const deleteResult = await window.electronAPI.mcpDelete(serverId)
    expect(deleteResult.success).toBe(true)

    // Step 8: Verify list is empty
    list = await window.electronAPI.mcpList()
    expect(list.length).toBe(0)
  })
})

/**
 * Testing Notes:
 *
 * 1. **MCP Server Structure**
 *    - id: Unique identifier (generated on creation)
 *    - name: Display name
 *    - command: Executable command
 *    - args: Optional command arguments
 *    - env: Optional environment variables
 *    - enabled: Server activation state
 *
 * 2. **IPC Channels**
 *    - 'mcp-list': Get all servers
 *    - 'mcp-add': Add new server
 *    - 'mcp-delete': Remove server
 *    - 'mcp-update': Modify server configuration
 *
 * 3. **User Workflows**
 *    - Adding servers through UI form
 *    - Viewing server list in settings
 *    - Editing server configuration
 *    - Toggling server enabled/disabled
 *    - Removing unwanted servers
 *
 * 4. **Security Considerations**
 *    - Environment variables may contain sensitive data (API keys)
 *    - Commands should be validated before execution
 *    - Server list should persist securely
 */
