// Test types for vitest + jest-dom compatibility
import '@testing-library/jest-dom'

declare global {
  namespace Vi {
    interface JestAssertion<T = any> extends jest.Matchers<void, T> {}
  }
}
