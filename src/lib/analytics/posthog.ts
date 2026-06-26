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

/**
 * PostHog analytics "shell".
 *
 * This module is intentionally a thin, defensive wrapper around `posthog-js`.
 * It is a no-op unless `VITE_PUBLIC_POSTHOG_KEY` is provided through the
 * environment at build time. The key is NEVER committed to the app code — it is
 * supplied via the environment (see `.env.development` for the placeholder).
 *
 * What it tracks:
 *  - Autocapture: every click/input, which powers "most used feature buttons"
 *    and PostHog's built-in rage-click detection ($rageclick).
 *  - Exception autocapture ($exception) for surfacing error issues.
 *  - `app_opened` / `first_task_started` / `task_started` custom events, which
 *    let us measure how long it takes a user to start their first task.
 */
import type { PostHog } from 'posthog-js';

// Lazily resolved instance. We import posthog-js dynamically inside init() so
// the bundle isn't paying for it when analytics is disabled.
let client: PostHog | null = null;

/** Wall-clock time the renderer booted; baseline for time-to-first-task. */
const appOpenedAt = Date.now();

/** Per-session guard so we only flag one "first task of this session". */
let firstTaskCapturedThisSession = false;

const HAS_STARTED_TASK_KEY = 'eigent:analytics:has_started_task';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as
  | string
  | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) ||
  'https://us.i.posthog.com';

export function isAnalyticsEnabled(): boolean {
  return Boolean(client);
}

/**
 * Initialise PostHog once, at app startup. Safe to call when no key is set —
 * it simply returns without doing anything, leaving every other helper a no-op.
 */
export async function initAnalytics(): Promise<void> {
  if (client) return;
  if (!POSTHOG_KEY) {
    if (import.meta.env.DEV) {
      console.info(
        '[analytics] VITE_PUBLIC_POSTHOG_KEY not set — PostHog disabled.'
      );
    }
    return;
  }

  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Autocapture powers "most used buttons" + rage-click detection.
      autocapture: true,
      rageclick: true,
      // SPA pageviews (HashRouter in Electron / BrowserRouter on web).
      capture_pageview: true,
      capture_pageleave: true,
      // NOTE: PostHog's `capture_exceptions` autocapture lazy-loads a remote
      // script from the assets host, which the renderer CSP (index.html)
      // blocks. We attach our own bundled error handlers below instead, so no
      // CSP changes / remote scripts are needed.
      // Electron renders from file://, where cookies are unreliable.
      persistence: 'localStorage+cookie',
      // Session replay can be turned on from the PostHog project settings; we
      // don't force-load the recorder here.
      disable_session_recording: true,
      loaded: (ph) => {
        if (import.meta.env.DEV) ph.debug(false);
      },
    });
    client = posthog;
    attachErrorHandlers(posthog);
    capture('app_opened', { channel: detectChannel() });
  } catch (error) {
    console.error('[analytics] Failed to initialise PostHog:', error);
  }
}

/** Associate subsequent events with a signed-in user. */
export function identifyUser(user: {
  id: string | number;
  email?: string | null;
  username?: string | null;
}): void {
  if (!client) return;
  try {
    client.identify(String(user.id), {
      email: user.email ?? undefined,
      username: user.username ?? undefined,
    });
  } catch (error) {
    console.error('[analytics] identify failed:', error);
  }
}

/** Clear the identified user (call on logout). */
export function resetAnalytics(): void {
  if (!client) return;
  try {
    client.reset();
  } catch (error) {
    console.error('[analytics] reset failed:', error);
  }
}

/** Generic, defensive event capture. */
export function capture(
  event: string,
  properties?: Record<string, unknown>
): void {
  if (!client) return;
  try {
    client.capture(event, properties);
  } catch (error) {
    console.error(`[analytics] capture("${event}") failed:`, error);
  }
}

/**
 * Report a caught exception to PostHog's error tracking. `captureException` is
 * part of the core bundle (unlike the `capture_exceptions` autocapture option,
 * which pulls a remote script), so this works without any CSP changes. Safe to
 * call from React error boundaries or manual try/catch blocks.
 */
export function captureException(
  error: unknown,
  properties?: Record<string, unknown>
): void {
  if (!client) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    client.captureException(err, properties);
  } catch (e) {
    console.error('[analytics] captureException failed:', e);
  }
}

/**
 * Wire global, fully-bundled error listeners so uncaught errors and rejected
 * promises surface as $exception events — without loading PostHog's remote
 * exception-autocapture extension.
 */
function attachErrorHandlers(posthog: PostHog): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    const err =
      event.error instanceof Error ? event.error : new Error(event.message);
    posthog.captureException(err, { mechanism: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    posthog.captureException(err, { mechanism: 'unhandledrejection' });
  });
}

/**
 * Explicit helper for tracking a feature button / action. Autocapture already
 * records raw clicks, but calling this for the buttons we care about gives a
 * clean, named event that's easy to chart.
 */
export function trackFeature(
  feature: string,
  properties?: Record<string, unknown>
): void {
  capture('feature_used', { feature, ...properties });
}

/**
 * Record that a user started a task. Emits `task_started` always, plus a
 * dedicated `first_task_started` (with the elapsed time since the app opened)
 * the first time a given install starts a task — that's the metric for
 * "how long does it take a user to start their first task".
 */
export function trackTaskStarted(properties?: Record<string, unknown>): void {
  const secondsSinceAppOpen = (Date.now() - appOpenedAt) / 1000;
  const hasStartedBefore = readHasStartedTask();
  const isFirstTaskThisSession = !firstTaskCapturedThisSession;
  firstTaskCapturedThisSession = true;

  capture('task_started', {
    ...properties,
    is_first_task_ever: !hasStartedBefore,
    is_first_task_this_session: isFirstTaskThisSession,
    seconds_since_app_open: round(secondsSinceAppOpen),
  });

  if (!hasStartedBefore) {
    capture('first_task_started', {
      ...properties,
      seconds_since_app_open: round(secondsSinceAppOpen),
    });
    writeHasStartedTask();
  }
}

function detectChannel(): 'web' | 'desktop' {
  // Electron exposes ipcRenderer on window; web does not.
  return typeof window !== 'undefined' && (window as any).ipcRenderer
    ? 'desktop'
    : 'web';
}

function readHasStartedTask(): boolean {
  try {
    return localStorage.getItem(HAS_STARTED_TASK_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeHasStartedTask(): void {
  try {
    localStorage.setItem(HAS_STARTED_TASK_KEY, 'true');
  } catch {
    // localStorage unavailable — degrade silently.
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
