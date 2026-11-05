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

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

const SCAN_DURATION_MS = 2000;

/**
 * Every scan shares one clock, so handing over from one surface to the next
 * keeps the same sweep instead of starting again from the left.
 */
function ScanBand() {
  const [phaseMs] = useState(() => performance.now() % SCAN_DURATION_MS);
  return (
    <div
      aria-hidden
      className="session-loading-scan"
      style={{
        animationDuration: `${SCAN_DURATION_MS}ms`,
        animationDelay: `-${phaseMs}ms`,
      }}
    />
  );
}

/**
 * The Session loading state: a faint band of the accent color sweeps left to
 * right on a loop, like a printer's scan, and fades out once content arrives.
 * It covers the nearest positioned parent and never takes pointer input.
 */
export function SessionLoadingScan({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          key="scan"
          aria-busy
          aria-label={label}
          className="pointer-events-none absolute inset-0 overflow-hidden"
          data-session-loading-scan
          exit={{ opacity: 0 }}
          initial={false}
          role="status"
          transition={{
            duration: reduceMotion ? 0 : 0.2,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          <ScanBand />
          <span className="sr-only">{label}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
