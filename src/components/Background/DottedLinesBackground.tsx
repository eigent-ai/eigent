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

const LINE_SPACING = 28;
/** Tile width so dash pattern repeats seamlessly when tiled. */
const DASH_TILE = 32;

/** Horizontal dotted guide lines, for use inside a `relative` container. */
export default function DottedLinesBackground() {
  const patternId = `${useId().replace(/:/g, '')}-dotted-ruled`;

  return (
    <svg
      className="inset-0 pointer-events-none absolute z-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <pattern
          id={patternId}
          width={DASH_TILE}
          height={LINE_SPACING}
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1={LINE_SPACING - 0.5}
            x2={DASH_TILE}
            y2={LINE_SPACING - 0.5}
            className="stroke-ds-border-neutral-default-default"
            strokeWidth={1}
            strokeDasharray="2 6"
            strokeLinecap="round"
            opacity={0.4}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
