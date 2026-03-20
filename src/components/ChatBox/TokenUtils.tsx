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

import { animate, useMotionValue } from 'framer-motion';
import React, { useEffect, useState } from 'react';

/**
 * Format a raw token count into a compact human-readable string.
 *   < 1 000        → "950"
 *   1 000 – 999 999 → "1.2K"
 *   ≥ 1 000 000    → "2.3M"
 */
const TOKEN_UNITS = [
  { threshold: 1_000_000_000_000, suffix: 'T' },
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
] as const;

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0';

  for (let index = 0; index < TOKEN_UNITS.length; index++) {
    const unit = TOKEN_UNITS[index];

    if (Math.abs(n) < unit.threshold) {
      continue;
    }

    const rounded = Number((n / unit.threshold).toFixed(1));
    const higherUnit = TOKEN_UNITS[index - 1];

    if (Math.abs(rounded) >= 1000 && higherUnit) {
      return `${(n / higherUnit.threshold).toFixed(1)}${higherUnit.suffix}`;
    }

    return `${rounded.toFixed(1)}${unit.suffix}`;
  }

  return String(Math.round(n));
}

interface AnimatedTokenNumberProps {
  value: number;
  className?: string;
}

/**
 * Renders a formatted token count that smoothly animates on change.
 * The underlying integer interpolates via a spring so the formatted
 * label updates fluidly without aggressive bouncing.
 */
export const AnimatedTokenNumber: React.FC<AnimatedTokenNumberProps> = ({
  value,
  className,
}) => {
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return controls.stop;
  }, [value, motionValue]);

  return <span className={className}>{formatTokenCount(display)}</span>;
};
