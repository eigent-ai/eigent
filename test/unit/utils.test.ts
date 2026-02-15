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

// Example unit test for utility functions
import { cn } from '@/lib/utils';
import { describe, expect, it } from 'vitest';

describe('utils', () => {
  describe('cn function', () => {
    it('should merge class names correctly', () => {
      const result = cn('class1', 'class2');
      expect(result).toBe('class1 class2');
    });

    it('should handle conditional classes', () => {
      const shouldShowConditional = true;
      const shouldHide = false;
      const result = cn(
        'base',
        shouldShowConditional ? 'conditional' : undefined,
        shouldHide ? 'hidden' : undefined
      );
      expect(result).toBe('base conditional');
    });

    it('should handle object-style classes', () => {
      const result = cn('base', {
        active: true,
        disabled: false,
      });
      expect(result).toBe('base active');
    });

    it('should merge conflicting Tailwind classes correctly', () => {
      // twMerge should handle conflicting classes
      const result = cn('p-2', 'p-4');
      expect(result).toBe('p-4');
    });

    it('should handle empty inputs', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('should handle null and undefined inputs', () => {
      const result = cn('base', null, undefined, 'valid');
      expect(result).toBe('base valid');
    });

    it('should handle arrays of classes', () => {
      const result = cn(['class1', 'class2'], 'class3');
      expect(result).toBe('class1 class2 class3');
    });
  });
});
