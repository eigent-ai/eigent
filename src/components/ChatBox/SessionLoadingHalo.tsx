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
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * A load that finishes within this time reads as instant, so the halo never
 * appears and the content shows as soon as it is ready.
 */
export const SESSION_LOADING_SHOW_DELAY_MS = 300;

/** Once the halo appears it stays at least this long, so it never flashes. */
export const SESSION_LOADING_MIN_VISIBLE_MS = 600;

/**
 * How long the page waits after everything reports ready before this
 * Session counts as shown, so a part that starts loading just after it
 * mounts still gets the page's halo.
 */
export const SESSION_LOADING_SETTLE_MS = 32;

/** The halo fades in a little slower than it leaves. */
const HALO_ENTER_S = 0.25;
/**
 * The halo's exit and the content's fade-in are one crossfade, so they share
 * this duration and {@link HALO_EASE}.
 */
const HALO_EXIT_S = 0.2;
const HALO_EASE = [0.23, 1, 0.32, 1] as const;

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
  fadeIn = false,
}: {
  active: boolean;
  label: string;
  /** Fade in rather than appear at once, for a halo shown after a delay. */
  fadeIn?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          key="halo"
          animate={{
            opacity: 1,
            transition: {
              duration: reduceMotion ? 0 : HALO_ENTER_S,
              ease: HALO_EASE,
            },
          }}
          aria-busy
          className="session-loading-halo-frame pointer-events-none absolute inset-0 overflow-hidden"
          data-session-loading-halo
          exit={{
            opacity: 0,
            transition: {
              duration: reduceMotion ? 0 : HALO_EXIT_S,
              ease: HALO_EASE,
            },
          }}
          initial={fadeIn && !reduceMotion ? { opacity: 0 } : false}
          role="status"
        >
          <HaloGlow />
          <span className="sr-only">{label}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

interface SessionLoadingReporter {
  report: (source: string, loading: boolean, label?: string) => void;
  /** True while the page has not yet shown this Session's content. */
  ownsLoading: boolean;
}

const SessionLoadingContext = createContext<SessionLoadingReporter | null>(
  null
);

/**
 * Tell the Session page that part of it is still loading. Returns true while
 * the page covers its first load with its own halo, so the caller should not
 * draw one; afterwards the caller shows its own loading state.
 */
export function useReportSessionLoading(
  source: string,
  loading: boolean,
  label?: string
): boolean {
  const context = useContext(SessionLoadingContext);
  const report = context?.report;
  // Before paint, so a Session that is still loading is never painted first.
  useLayoutEffect(() => {
    report?.(source, loading, label);
  }, [report, source, loading, label]);
  useLayoutEffect(() => () => report?.(source, false), [report, source]);
  return Boolean(context?.ownsLoading);
}

/**
 * The Session page's first load. Until everything it waits for is ready, the
 * header, chat and composer stay hidden and one halo fills the whole Session
 * area. A load faster than {@link SESSION_LOADING_SHOW_DELAY_MS} shows no
 * halo at all; the content simply appears. Once this Session's content has
 * shown, later loading belongs to the parts that load.
 */
export function SessionLoadingCover({
  sessionKey,
  loading,
  skip = false,
  label,
  children,
}: {
  /** The Session shown; a new one starts a new first load. */
  sessionKey: string;
  /** The page's own waits, such as the Session's route. */
  loading: boolean;
  /** Show the content at once, for a Session the user has just started. */
  skip?: boolean;
  label: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [reports, setReports] = useState<Record<string, string | undefined>>(
    {}
  );
  const report = useCallback(
    (source: string, isLoading: boolean, sourceLabel?: string) => {
      setReports((current) => {
        if (isLoading) {
          if (source in current && current[source] === sourceLabel) {
            return current;
          }
          return { ...current, [source]: sourceLabel };
        }
        if (!(source in current)) return current;
        const next = { ...current };
        delete next[source];
        return next;
      });
    },
    []
  );
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [haloShownAt, setHaloShownAt] = useState<number | null>(null);
  const [fadeContent, setFadeContent] = useState(false);
  const pending = loading || Object.keys(reports).length > 0;
  const ownsLoading = !skip && shownKey !== sessionKey;
  const hidden = ownsLoading && (pending || haloShownAt !== null);
  const openedAt = useRef<{ sessionKey: string; at: number } | null>(null);

  useEffect(() => {
    if (openedAt.current?.sessionKey !== sessionKey) {
      openedAt.current = { sessionKey, at: Date.now() };
    }
    if (!ownsLoading) {
      setHaloShownAt(null);
      return;
    }
    if (pending) {
      if (haloShownAt !== null) return;
      // The delay counts from opening, not from the latest wait.
      const timer = window.setTimeout(
        () => setHaloShownAt(Date.now()),
        Math.max(
          0,
          SESSION_LOADING_SHOW_DELAY_MS - (Date.now() - openedAt.current.at)
        )
      );
      return () => window.clearTimeout(timer);
    }
    // Ready. Wait a moment for parts that only start loading after they
    // mount, and keep a halo that has just appeared up for its minimum time.
    const remaining =
      haloShownAt === null
        ? SESSION_LOADING_SETTLE_MS
        : Math.max(
            SESSION_LOADING_SETTLE_MS,
            SESSION_LOADING_MIN_VISIBLE_MS - (Date.now() - haloShownAt)
          );
    const timer = window.setTimeout(() => {
      // Fade the content in only behind a halo; otherwise it just appears.
      setFadeContent(haloShownAt !== null);
      setHaloShownAt(null);
      setShownKey(sessionKey);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [ownsLoading, pending, haloShownAt, sessionKey]);

  // React 18 does not serialize the `inert` JSX prop; set it natively so
  // hidden controls cannot take focus or clicks.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.toggleAttribute('inert', hidden);
  }, [hidden]);

  const reportedLabel = Object.values(reports).find(Boolean);
  const value = useMemo(() => ({ report, ownsLoading }), [report, ownsLoading]);
  return (
    <SessionLoadingContext.Provider value={value}>
      <div
        className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
        data-session-loading-cover={hidden ? 'hidden' : 'shown'}
      >
        <div
          ref={contentRef}
          aria-hidden={hidden || undefined}
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            hidden && 'opacity-0',
            !hidden &&
              fadeContent &&
              !reduceMotion &&
              'transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]'
          )}
        >
          {children}
        </div>
        <SessionLoadingHalo
          active={hidden && haloShownAt !== null}
          fadeIn
          label={reportedLabel ?? label}
        />
      </div>
    </SessionLoadingContext.Provider>
  );
}
