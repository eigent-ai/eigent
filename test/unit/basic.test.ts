// Simple example test to verify testing setup
import { describe, it, expect, vi } from 'vitest'

describe('Basic Testing Setup', () => {
  it('should be able to run basic tests', () => {
    expect(1 + 1).toBe(2)
  })

  it('should handle string operations', () => {
    const greeting = 'Hello, World!'
    expect(greeting).toContain('World')
    expect(greeting.length).toBe(13)
  })

  it('should handle array operations', () => {
    const numbers = [1, 2, 3, 4, 5]
    expect(numbers).toHaveLength(5)
    expect(numbers).toContain(3)
    expect(numbers.reduce((a, b) => a + b, 0)).toBe(15)
  })

  it('should handle async operations', async () => {
    const asyncFunction = () => Promise.resolve('async result')
    const result = await asyncFunction()
    expect(result).toBe('async result')
  })

  it('should handle mock functions', () => {
    const mockFn = vi.fn()
    mockFn('test argument')
    
    expect(mockFn).toHaveBeenCalledOnce()
    expect(mockFn).toHaveBeenCalledWith('test argument')
  })
})

// Mock example

const mockMathOperations = {
  add: (a: number, b: number) => a + b,
  multiply: (a: number, b: number) => a * b
}

describe('Mock Example', () => {
  it('should mock functions correctly', () => {
    const mockAdd = vi.spyOn(mockMathOperations, 'add')
    mockAdd.mockReturnValue(10)
    
    const result = mockMathOperations.add(2, 3)
    expect(result).toBe(10) // Returns mocked value, not actual sum
    expect(mockAdd).toHaveBeenCalledWith(2, 3)
  })
})
