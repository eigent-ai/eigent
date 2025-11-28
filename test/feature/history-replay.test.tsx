import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockProjectStore, ProjectType } from '../mocks/projectStore.mock'

/**
 * Feature Test: History Replay
 *
 * User Journey: User opens history → Selects past project → Replays conversation
 *
 * This test suite validates the history replay functionality using the mock store.
 * It focuses on the replayProject feature and related state management.
 */

describe('Feature Test: History Replay', () => {
  beforeEach(() => {
    // Reset mock state before each test
    mockProjectStore.__reset()
  })

  /**
   * Test 1: Replay project with history ID
   *
   * Validates that users can replay a project from history:
   * - Creates replay project with correct type
   * - Sets history ID correctly
   * - Project has replay tag in metadata
   */
  it('creates replay project with history ID', () => {
    const replayProjectId = mockProjectStore.createProject(
      'Replay Project',
      'Replayed from history',
      'replay-123',
      ProjectType.REPLAY,
      'history-456'
    )

    // Verify project was created
    expect(replayProjectId).toBeDefined()
    expect(replayProjectId).toBe('replay-123')

    // Verify project has correct properties
    const project = mockProjectStore.getProjectById(replayProjectId)
    expect(project).toBeDefined()
    expect(project!.name).toBe('Replay Project')
    expect(project!.description).toBe('Replayed from history')

    // Verify project has replay metadata
    expect(project!.metadata?.tags).toContain('replay')
    expect(project!.metadata?.historyId).toBe('history-456')
  })

  /**
   * Test 2: History ID storage and retrieval
   *
   * Validates that history IDs are properly stored and retrieved:
   * - Can set history ID for a project
   * - Can retrieve history ID for a project
   */
  it('stores and retrieves history ID for projects', () => {
    // Create a normal project
    const projectId = mockProjectStore.createProject('Test Project')

    // Set history ID
    mockProjectStore.setHistoryId(projectId, 'history-789')

    // Retrieve history ID
    const historyId = mockProjectStore.getHistoryId(projectId)
    expect(historyId).toBe('history-789')

    // Verify it's stored in metadata
    const project = mockProjectStore.getProjectById(projectId)
    expect(project!.metadata?.historyId).toBe('history-789')
  })

  /**
   * Test 3: Multiple replay projects
   *
   * Validates that users can create multiple replay projects:
   * - Each replay project is independent
   * - Each has its own history ID
   * - Replay projects don't interfere with each other
   */
  it('creates multiple independent replay projects', () => {
    // Create first replay project
    const replay1Id = mockProjectStore.createProject(
      'Replay 1',
      'First replay',
      'replay-1',
      ProjectType.REPLAY,
      'history-1'
    )

    // Create second replay project
    const replay2Id = mockProjectStore.createProject(
      'Replay 2',
      'Second replay',
      'replay-2',
      ProjectType.REPLAY,
      'history-2'
    )

    // Verify both projects exist
    expect(replay1Id).not.toBe(replay2Id)

    const project1 = mockProjectStore.getProjectById(replay1Id)
    const project2 = mockProjectStore.getProjectById(replay2Id)

    // Verify both have replay tags
    expect(project1!.metadata?.tags).toContain('replay')
    expect(project2!.metadata?.tags).toContain('replay')

    // Verify different history IDs
    expect(project1!.metadata?.historyId).toBe('history-1')
    expect(project2!.metadata?.historyId).toBe('history-2')
  })

  /**
   * Test 4: Replay project is active after creation
   *
   * Validates that replay project becomes active:
   * - Newly created replay project is set as active
   * - Can switch between normal and replay projects
   */
  it('sets replay project as active after creation', () => {
    // Create a normal project
    const normalProjectId = mockProjectStore.createProject('Normal Project')
    expect(mockProjectStore.activeProjectId).toBe(normalProjectId)

    // Create a replay project
    const replayProjectId = mockProjectStore.createProject(
      'Replay Project',
      'Replayed',
      'replay-abc',
      ProjectType.REPLAY,
      'history-abc'
    )

    // Verify replay project is now active
    expect(mockProjectStore.activeProjectId).toBe(replayProjectId)

    // Verify both projects exist
    expect(mockProjectStore.getAllProjects().length).toBe(2)
  })

  /**
   * Test 5: Replay project with chat stores
   *
   * Validates that replay projects can have multiple chat stores:
   * - Replay project starts with initial chat store
   * - Can create additional chat stores in replay project
   * - Chat stores maintain replay context
   */
  it('manages chat stores within replay project', () => {
    // Create replay project
    const replayProjectId = mockProjectStore.createProject(
      'Replay Project',
      'Replayed',
      'replay-def',
      ProjectType.REPLAY,
      'history-def'
    )

    // Verify initial chat store exists
    const project = mockProjectStore.getProjectById(replayProjectId)
    expect(Object.keys(project!.chatStores).length).toBeGreaterThan(0)

    // Create additional chat store
    const newChatId = mockProjectStore.createChatStore(replayProjectId)
    expect(newChatId).toBeDefined()

    // Verify chat store was created
    const updatedProject = mockProjectStore.getProjectById(replayProjectId)
    expect(Object.keys(updatedProject!.chatStores).length).toBe(2)
    expect(updatedProject!.activeChatId).toBe(newChatId)
  })

  /**
   * Test 6: Normal projects don't have replay tag
   *
   * Validates that normal projects are distinguished from replay projects:
   * - Normal projects don't have replay tag
   * - Normal projects can have history ID without replay tag
   */
  it('distinguishes between normal and replay projects', () => {
    // Create normal project
    const normalProjectId = mockProjectStore.createProject('Normal Project')

    // Create replay project
    const replayProjectId = mockProjectStore.createProject(
      'Replay Project',
      'Replayed',
      'replay-ghi',
      ProjectType.REPLAY,
      'history-ghi'
    )

    // Verify normal project doesn't have replay tag
    const normalProject = mockProjectStore.getProjectById(normalProjectId)
    expect(normalProject!.metadata?.tags).not.toContain('replay')

    // Verify replay project has replay tag
    const replayProject = mockProjectStore.getProjectById(replayProjectId)
    expect(replayProject!.metadata?.tags).toContain('replay')
  })

  /**
   * Test 7: Retrieve history ID returns null for non-existent projects
   *
   * Validates error handling for history ID retrieval:
   * - Returns null for non-existent project
   * - Returns null for project without history ID
   */
  it('handles missing history ID gracefully', () => {
    // Try to get history ID for non-existent project
    const historyId1 = mockProjectStore.getHistoryId('non-existent')
    expect(historyId1).toBeNull()

    // Create project without history ID
    const projectId = mockProjectStore.createProject('Test Project')
    const historyId2 = mockProjectStore.getHistoryId(projectId)

    // Should return null or undefined for projects without historyId
    expect(historyId2).toBeNull()
  })

  /**
   * Test 8: Update history ID for existing project
   *
   * Validates that history ID can be updated:
   * - Can update existing history ID
   * - Updated value is persisted
   */
  it('updates history ID for existing project', () => {
    // Create project with initial history ID
    const projectId = mockProjectStore.createProject(
      'Test Project',
      'Description',
      'project-123',
      ProjectType.REPLAY,
      'history-old'
    )

    // Verify initial history ID
    expect(mockProjectStore.getHistoryId(projectId)).toBe('history-old')

    // Update history ID
    mockProjectStore.setHistoryId(projectId, 'history-new')

    // Verify updated history ID
    expect(mockProjectStore.getHistoryId(projectId)).toBe('history-new')

    // Verify it's in metadata
    const project = mockProjectStore.getProjectById(projectId)
    expect(project!.metadata?.historyId).toBe('history-new')
  })

  /**
   * Test 9: Replay projects in project list
   *
   * Validates that replay projects appear in project list:
   * - Replay projects are included in getAllProjects
   * - Can filter replay projects by tag
   */
  it('includes replay projects in project list', () => {
    // Create mixed projects
    const normal1 = mockProjectStore.createProject('Normal 1')
    const replay1 = mockProjectStore.createProject('Replay 1', '', 'replay-1', ProjectType.REPLAY, 'hist-1')
    const normal2 = mockProjectStore.createProject('Normal 2')
    const replay2 = mockProjectStore.createProject('Replay 2', '', 'replay-2', ProjectType.REPLAY, 'hist-2')

    // Get all projects
    const allProjects = mockProjectStore.getAllProjects()
    expect(allProjects.length).toBe(4)

    // Filter replay projects
    const replayProjects = allProjects.filter(p => p.metadata?.tags?.includes('replay'))
    expect(replayProjects.length).toBe(2)

    // Verify replay project IDs
    const replayIds = replayProjects.map(p => p.id)
    expect(replayIds).toContain(replay1)
    expect(replayIds).toContain(replay2)
    expect(replayIds).not.toContain(normal1)
    expect(replayIds).not.toContain(normal2)
  })

  /**
   * Test 10: Remove replay project
   *
   * Validates that replay projects can be removed:
   * - Replay project can be deleted
   * - History ID is removed with project
   * - Other projects remain unaffected
   */
  it('removes replay project and its history ID', () => {
    // Create normal and replay projects
    const normalId = mockProjectStore.createProject('Normal')
    const replayId = mockProjectStore.createProject(
      'Replay',
      'Description',
      'replay-xyz',
      ProjectType.REPLAY,
      'history-xyz'
    )

    // Verify both exist
    expect(mockProjectStore.getAllProjects().length).toBe(2)
    expect(mockProjectStore.getHistoryId(replayId)).toBe('history-xyz')

    // Remove replay project
    mockProjectStore.removeProject(replayId)

    // Verify replay project is removed
    expect(mockProjectStore.getProjectById(replayId)).toBeNull()
    expect(mockProjectStore.getAllProjects().length).toBe(1)

    // Verify normal project still exists
    expect(mockProjectStore.getProjectById(normalId)).toBeDefined()

    // Verify can't get history ID for removed project
    expect(mockProjectStore.getHistoryId(replayId)).toBeNull()
  })

  /**
   * Test 11: Replay project metadata persistence
   *
   * Validates that replay metadata is properly maintained:
   * - Metadata includes status, tags, and historyId
   * - Metadata persists through project updates
   */
  it('maintains replay metadata through updates', () => {
    // Create replay project
    const replayId = mockProjectStore.createProject(
      'Replay Project',
      'Original description',
      'replay-persist',
      ProjectType.REPLAY,
      'history-persist'
    )

    // Verify initial metadata
    let project = mockProjectStore.getProjectById(replayId)
    expect(project!.metadata?.tags).toContain('replay')
    expect(project!.metadata?.historyId).toBe('history-persist')
    expect(project!.metadata?.status).toBe('active')

    // Update project with additional metadata
    mockProjectStore.updateProject(replayId, {
      name: 'Updated Replay Project',
      metadata: {
        ...project!.metadata,
        priority: 'high',
        tags: [...(project!.metadata?.tags || []), 'important']
      }
    })

    // Verify metadata is preserved and updated
    project = mockProjectStore.getProjectById(replayId)
    expect(project!.name).toBe('Updated Replay Project')
    expect(project!.metadata?.tags).toContain('replay')
    expect(project!.metadata?.tags).toContain('important')
    expect(project!.metadata?.historyId).toBe('history-persist')
    expect(project!.metadata?.priority).toBe('high')
  })

  /**
   * Test 12: Empty check doesn't affect replay projects
   *
   * Validates that replay projects are treated appropriately:
   * - isEmpty check works for replay projects
   * - Replay projects with no messages are considered empty
   */
  it('correctly identifies empty replay projects', () => {
    // Create replay project
    const replayId = mockProjectStore.createProject(
      'Empty Replay',
      'Description',
      'replay-empty',
      ProjectType.REPLAY,
      'history-empty'
    )

    // Verify project exists
    const project = mockProjectStore.getProjectById(replayId)
    expect(project).toBeDefined()

    // Check if project is empty (has only initial chat store, no queued messages)
    const isEmpty = mockProjectStore.isEmptyProject(project!)
    expect(isEmpty).toBe(true)

    // Add a queued message
    mockProjectStore.addQueuedMessage(replayId, 'Test message', [])

    // Verify project is no longer empty
    const updatedProject = mockProjectStore.getProjectById(replayId)
    const isStillEmpty = mockProjectStore.isEmptyProject(updatedProject!)
    expect(isStillEmpty).toBe(false)
  })
})
