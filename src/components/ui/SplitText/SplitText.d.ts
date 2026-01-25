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

declare module "@/components/ui/SplitText/SplitText" {
  import type { FC } from "react";

  export interface SplitTextProps {
    text: string;
    className?: string;
    delay?: number;
    duration?: number;
    ease?: string;
    splitType?: string;
    from?: Record<string, unknown>;
    to?: Record<string, unknown>;
    threshold?: number;
    rootMargin?: string;
    textAlign?: string;
    tag?: string;
    onLetterAnimationComplete?: () => void;
  }

  const SplitText: FC<SplitTextProps>;
  export default SplitText;
}
declare module "@/components/SplitText" {
  import type { FC } from "react";

  type SplitType = 'chars' | 'words' | 'lines' | 'chars,words,lines' | string;

  interface SplitTextProps {
    text: string;
    className?: string;
    delay?: number; // ms between letters
    duration?: number; // seconds per letter
    ease?: string;
    splitType?: SplitType;
    from?: Record<string, unknown>;
    to?: Record<string, unknown>;
    threshold?: number; // 0..1
    rootMargin?: string; // like '-100px'
    textAlign?: 'left' | 'center' | 'right' | 'justify' | string;
    tag?: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    onLetterAnimationComplete?: () => void;
  }

  const SplitText: FC<SplitTextProps>;
  export default SplitText;
}


