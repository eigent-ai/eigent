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


