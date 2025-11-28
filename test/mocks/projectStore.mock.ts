import { vi } from 'vitest'

/**
 * Mock Project Store
 *
 * This mock provides a simplified project store implementation for testing.
 * It maintains the same interface as the real store but with controllable behavior.
 */

// Define ProjectType enum locally to avoid circular dependency
export enum ProjectType {
  NORMAL = 'normal',
  REPLAY = 'replay'
}

// Mock project data structure
interface MockProject {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  chatStores: { [chatId: string]: any }
  chatStoreTimestamps: { [chatId: string]: number }
  activeChatId: string | null
  queuedMessages: Array<{ task_id: string; content: string; timestamp: number; attaches: File[] }>
  metadata?: {
    tags?: string[]
    priority?: 'low' | 'medium' | 'high'
    status?: 'active' | 'completed' | 'archived'
    historyId?: string
  }
}

// Mock state
const mockState = {
  activeProjectId: null as string | null,
  projects: {} as { [projectId: string]: MockProject },
}

// Helper to generate unique IDs
let idCounter = 0
const generateMockId = () => {
  idCounter++
  return `mock-project-${idCounter}`
}

// Helper to create mock chat store
const createMockChatStore = () => {
  const chatIdCounter = Math.random().toString(36).substring(7)
  return {
    id: `mock-chat-${chatIdCounter}`,
    getState: vi.fn(() => ({
      tasks: {},
      activeTaskId: null,
      updateCount: 0,
    })),
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
  }
}

// Mock project store implementation
export const mockProjectStore = {
  activeProjectId: null as string | null,
  projects: {} as { [projectId: string]: MockProject },

  createProject: vi.fn((name: string, description?: string, projectId?: string, type?: ProjectType, historyId?: string) => {
    const id = projectId || generateMockId()
    const now = Date.now()
    const initialChatId = `chat-${id}`
    const initialChatStore = createMockChatStore()

    mockState.projects[id] = {
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      chatStores: { [initialChatId]: initialChatStore },
      chatStoreTimestamps: { [initialChatId]: now },
      activeChatId: initialChatId,
      queuedMessages: [],
      metadata: {
        status: 'active',
        historyId,
        tags: type === ProjectType.REPLAY ? ['replay'] : [],
      },
    }

    mockState.activeProjectId = id
    mockProjectStore.activeProjectId = id
    mockProjectStore.projects = { ...mockState.projects }

    return id
  }),

  setActiveProject: vi.fn((projectId: string) => {
    if (mockState.projects[projectId]) {
      mockState.activeProjectId = projectId
      mockProjectStore.activeProjectId = projectId
      mockState.projects[projectId].updatedAt = Date.now()
    }
  }),

  removeProject: vi.fn((projectId: string) => {
    if (mockState.projects[projectId]) {
      delete mockState.projects[projectId]

      if (mockState.activeProjectId === projectId) {
        const remainingIds = Object.keys(mockState.projects)
        mockState.activeProjectId = remainingIds.length > 0 ? remainingIds[0] : null
        mockProjectStore.activeProjectId = mockState.activeProjectId
      }

      mockProjectStore.projects = { ...mockState.projects }
    }
  }),

  updateProject: vi.fn((projectId: string, updates: Partial<MockProject>) => {
    if (mockState.projects[projectId]) {
      mockState.projects[projectId] = {
        ...mockState.projects[projectId],
        ...updates,
        updatedAt: Date.now(),
      }
      mockProjectStore.projects = { ...mockState.projects }
    }
  }),

  createChatStore: vi.fn((projectId: string, chatName?: string) => {
    const project = mockState.projects[projectId]
    if (!project) return null

    const chatId = `chat-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const newChatStore = createMockChatStore()
    const now = Date.now()

    project.chatStores[chatId] = newChatStore
    project.chatStoreTimestamps[chatId] = now
    project.activeChatId = chatId
    project.updatedAt = now

    return chatId
  }),

  setActiveChatStore: vi.fn((projectId: string, chatId: string) => {
    const project = mockState.projects[projectId]
    if (project && project.chatStores[chatId]) {
      project.activeChatId = chatId
      project.updatedAt = Date.now()
    }
  }),

  removeChatStore: vi.fn((projectId: string, chatId: string) => {
    const project = mockState.projects[projectId]
    if (!project) return

    const chatStoreKeys = Object.keys(project.chatStores)
    if (chatStoreKeys.length === 1) return // Don't remove last chat store

    delete project.chatStores[chatId]

    if (project.activeChatId === chatId) {
      const remainingChats = chatStoreKeys.filter(id => id !== chatId)
      project.activeChatId = remainingChats[0]
    }
  }),

  getChatStore: vi.fn((projectId?: string, chatId?: string) => {
    const targetProjectId = projectId || mockState.activeProjectId
    if (!targetProjectId || !mockState.projects[targetProjectId]) return null

    const project = mockState.projects[targetProjectId]
    const targetChatId = chatId || project.activeChatId

    if (targetChatId && project.chatStores[targetChatId]) {
      return project.chatStores[targetChatId]
    }

    return null
  }),

  getActiveChatStore: vi.fn((projectId?: string) => {
    const targetProjectId = projectId || mockState.activeProjectId
    if (!targetProjectId || !mockState.projects[targetProjectId]) return null

    const project = mockState.projects[targetProjectId]
    if (project.activeChatId && project.chatStores[project.activeChatId]) {
      return project.chatStores[project.activeChatId]
    }

    return null
  }),

  addQueuedMessage: vi.fn((projectId: string, content: string, attaches: File[]) => {
    const project = mockState.projects[projectId]
    if (!project) return null

    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`
    project.queuedMessages.push({
      task_id: taskId,
      content,
      timestamp: Date.now(),
      attaches: [...attaches],
    })
    project.updatedAt = Date.now()

    return taskId
  }),

  removeQueuedMessage: vi.fn((projectId: string, taskId: string) => {
    const project = mockState.projects[projectId]
    if (!project) return

    project.queuedMessages = project.queuedMessages.filter(m => m.task_id !== taskId)
    project.updatedAt = Date.now()
  }),

  clearQueuedMessages: vi.fn((projectId: string) => {
    const project = mockState.projects[projectId]
    if (!project) return

    project.queuedMessages = []
    project.updatedAt = Date.now()
  }),

  getAllProjects: vi.fn(() => {
    return Object.values(mockState.projects).sort((a, b) => b.updatedAt - a.updatedAt)
  }),

  getProjectById: vi.fn((projectId: string) => {
    return mockState.projects[projectId] || null
  }),

  getAllChatStores: vi.fn((projectId: string) => {
    const project = mockState.projects[projectId]
    if (!project) return []

    return Object.entries(project.chatStores)
      .map(([chatId, chatStore]) => ({
        chatId,
        chatStore,
        createdAt: project.chatStoreTimestamps?.[chatId] || 0,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ chatId, chatStore }) => ({ chatId, chatStore }))
  }),

  getProjectTotalTokens: vi.fn((projectId: string) => {
    // Mock implementation returns 0 tokens
    return 0
  }),

  setHistoryId: vi.fn((projectId: string, historyId: string) => {
    const project = mockState.projects[projectId]
    if (!project) return

    project.metadata = {
      ...project.metadata,
      historyId,
    }
    project.updatedAt = Date.now()
  }),

  getHistoryId: vi.fn((projectId: string | null) => {
    if (!projectId || !mockState.projects[projectId]) return null
    return mockState.projects[projectId].metadata?.historyId || null
  }),

  isEmptyProject: vi.fn((project: MockProject) => {
    // Simplified empty check for mock
    const chatStoreIds = Object.keys(project.chatStores)
    return (
      chatStoreIds.length === 1 &&
      project.queuedMessages.length === 0
    )
  }),

  // Test utilities
  __reset: () => {
    idCounter = 0
    mockState.activeProjectId = null
    mockState.projects = {}
    mockProjectStore.activeProjectId = null
    mockProjectStore.projects = {}
    vi.clearAllMocks()
  },

  __getState: () => mockState,
}

// Mock the project store module
export const mockUseProjectStore = vi.fn(() => mockProjectStore)

// Export for use in vi.mock
export default {
  useProjectStore: mockUseProjectStore,
  ProjectType,
}
