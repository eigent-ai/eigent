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

import { useId } from 'react';

const PATTERN_STEP = 20;

/** Solid dot grid overlay (`var(--border-secondary)`), for use inside a `relative` container. */
export default function DotPatternBackground() {
  const patternId = `${useId().replace(/:/g, '')}-dot`;

  return (
    <svg
      className="inset-0 pointer-events-none absolute z-0 h-full w-full opacity-30"
      aria-hidden
    >
      <defs>
        <pattern
          id={patternId}
          width={PATTERN_STEP}
          height={PATTERN_STEP}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={PATTERN_STEP / 2}
            cy={PATTERN_STEP / 2}
            r={1.25}
            fill="var(--border-secondary)"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
