// Example unit test for utility functions
import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('utils', () => {
  describe('cn function', () => {
    it('should merge class names correctly', () => {
      const result = cn('class1', 'class2')
      expect(result).toBe('class1 class2')
    })

    it('should handle conditional classes', () => {
      const result = cn('base', true && 'conditional', false && 'hidden')
      expect(result).toBe('base conditional')
    })

    it('should handle object-style classes', () => {
      const result = cn('base', {
        'active': true,
        'disabled': false
      })
      expect(result).toBe('base active')
    })

    it('should merge conflicting Tailwind classes correctly', () => {
      // twMerge should handle conflicting classes
      const result = cn('p-2', 'p-4')
      expect(result).toBe('p-4')
    })

    it('should handle empty inputs', () => {
      const result = cn()
      expect(result).toBe('')
    })

    it('should handle null and undefined inputs', () => {
      const result = cn('base', null, undefined, 'valid')
      expect(result).toBe('base valid')
    })

    it('should handle arrays of classes', () => {
      const result = cn(['class1', 'class2'], 'class3')
      expect(result).toBe('class1 class2 class3')
    })
  })
})
