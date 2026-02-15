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

import React, { useEffect, useMemo, useState } from 'react';
import './WordCarousel.css';

export type WordCarouselProps = {
  words: string[];
  className?: string;
  rotateIntervalMs?: number;
  sweepDurationMs?: number;
  gradient?: string;
  ariaLabel?: string;
  sweepOnce?: boolean;
};

export function WordCarousel({
  words,
  className,
  rotateIntervalMs = 1600,
  sweepDurationMs = 2200,
  gradient,
  ariaLabel,
  sweepOnce = false,
}: WordCarouselProps) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  const safeWords = useMemo(
    () => (words && words.length > 0 ? words : ['']),
    [words]
  );

  useEffect(() => {
    if (safeWords.length <= 1) return;
    const interval = setInterval(() => {
      setFading(true);
      const timeout = setTimeout(
        () => {
          setIndex((prev) => (prev + 1) % safeWords.length);
          setFading(false);
        },
        Math.min(300, Math.max(150, rotateIntervalMs * 0.25))
      );
      return () => clearTimeout(timeout);
    }, rotateIntervalMs);
    return () => clearInterval(interval);
  }, [rotateIntervalMs, safeWords.length]);

  const gradientValue = useMemo(
    () =>
      gradient ??
      'linear-gradient(in oklch 90deg, #1d1d1d 0%, #1d1d1d 30%, #FF0099 35%, #FF0000 45%, #FF4F04 50%, #FFA600 55%, #F8F8F8 60%, #0056FF 65%, #f9f8f6 70%, #f9f8f6 100%)',
    [gradient]
  );

  const style: React.CSSProperties = {
    // @ts-ignore -- CSS var is fine here
    '--word-gradient': gradientValue,

    // @ts-ignore -- CSS var is fine here
    '--sweep-duration': `${sweepDurationMs}ms`,
  } as React.CSSProperties;

  return (
    <span
      className={[
        'word-carousel',
        sweepOnce ? 'sweep-once' : '',
        fading ? 'is-fading' : '',
        className ?? '',
      ]
        .join(' ')
        .trim()}
      aria-label={ariaLabel}
      style={style}
    >
      {safeWords[index]}
    </span>
  );
}

export default WordCarousel;
