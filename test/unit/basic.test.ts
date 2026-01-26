// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

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
