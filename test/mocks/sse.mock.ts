import { vi } from "vitest"

// Mock fetchEventSource
export const mockFetchEventSource = vi.fn()

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (...args: any[]) => mockFetchEventSource(...args),
}))