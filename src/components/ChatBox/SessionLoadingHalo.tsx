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

import eigentIconBlack from '@/assets/logo/icon_black.svg';
import eigentIconWhite from '@/assets/logo/icon_white.svg';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type CSSProperties, useEffect, useState } from 'react';

/**
 * A halo that leaves and comes back within this window is the same wait, for
 * example the Session fallback handing over to the timeline. It carries on
 * from where it was in the loop instead of starting a new ring.
 */
const HANDOVER_MS = 400;

let haloStartedAt: number | null = null;
let haloEndedAt: number | null = null;
let haloMounted = 0;

function joinHaloClock(now: number): number {
  const continuing =
    haloStartedAt !== null &&
    (haloMounted > 0 ||
      (haloEndedAt !== null && now - haloEndedAt < HANDOVER_MS));
  if (!continuing) haloStartedAt = now;
  return now - (haloStartedAt ?? now);
}

function HaloGlow() {
  const [elapsedMs] = useState(() => joinHaloClock(performance.now()));

  useEffect(() => {
    haloMounted += 1;
    return () => {
      haloMounted -= 1;
      if (haloMounted === 0) haloEndedAt = performance.now();
    };
  }, []);

  // The CSS turns this into a negative delay, so a handover joins the loop
  // where the previous surface left it.
  const clock = {
    '--halo-elapsed': `${Math.round(elapsedMs)}ms`,
  } as CSSProperties;
  return (
    <>
      <div aria-hidden className="session-loading-halo" style={clock} />
      <div className="absolute inset-0 flex items-center justify-center">
        {/* Both marks render; the theme stylesheet shows the one that fits. */}
        <div className="session-loading-halo-logo size-10" style={clock}>
          <img
            src={eigentIconBlack}
            alt=""
            draggable={false}
            className="session-loading-halo-logo-light size-full select-none"
          />
          <img
            src={eigentIconWhite}
            alt=""
            draggable={false}
            className="session-loading-halo-logo-dark size-full select-none"
          />
        </div>
      </div>
    </>
  );
}

/**
 * The Session loading state: a ring of light in the user's accent flows up
 * from below the content area, sweeps out past the top and disappears, then
 * the next one starts after a short pause, while the Eigent mark brightens as
 * each ring passes it. Both fade out once content arrives. It covers the
 * nearest positioned parent and never takes pointer input.
 */
export function SessionLoadingHalo({
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
          key="halo"
          aria-busy
          className="session-loading-halo-frame pointer-events-none absolute inset-0 overflow-hidden"
          data-session-loading-halo
          exit={{ opacity: 0 }}
          initial={false}
          role="status"
          transition={{
            duration: reduceMotion ? 0 : 0.32,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          <HaloGlow />
          <span className="sr-only">{label}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
