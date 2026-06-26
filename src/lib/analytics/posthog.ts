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
 *  - Bundled exception capture for surfacing error issues.
 *  - A named-event taxonomy (app_launched / task_submitted / task_completed /
 *    first_task_* / feature_used / *_failed …) wired at code chokepoints — see
 *    the desktop tracking plan.
 *
 * Identity is keyed on **email** so a person's website activity (channel/UTM/
 * content) merges with their desktop activity into a single PostHog person.
 */
import type { PostHog } from 'posthog-js';

// Lazily resolved instance. We import posthog-js dynamically inside init() so
// the bundle isn't paying for it when analytics is disabled.
let client: PostHog | null = null;

/** Wall-clock time the renderer booted; baseline for time-to-first-task. */
const appOpenedAt = Date.now();

/** Per-session guards so we only flag one "first task of this session". */
let firstSubmitCapturedThisSession = false;

const HAS_SUBMITTED_TASK_KEY = 'eigent:analytics:has_started_task';
const HAS_COMPLETED_TASK_KEY = 'eigent:analytics:has_completed_task';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as
  | string
  | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) ||
  'https://us.i.posthog.com';

export function isAnalyticsEnabled(): boolean {
  return Boolean(client);
}

/** Context for the one-time `app_launched` event, gathered by the caller. */
export interface AppLaunchContext {
  isFirstLaunch?: boolean;
  version?: string;
}

/**
 * Initialise PostHog once, at app startup. Safe to call when no key is set —
 * it simply returns without doing anything, leaving every other helper a no-op.
 * Emits the one-time `app_launched` event once the client is ready.
 */
export async function initAnalytics(
  launchContext?: AppLaunchContext
): Promise<void> {
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
    capture('app_launched', {
      is_first_launch: launchContext?.isFirstLaunch ?? null,
      platform: detectPlatform(),
      version: launchContext?.version ?? null,
      channel: detectChannel(),
    });
  } catch (error) {
    console.error('[analytics] Failed to initialise PostHog:', error);
  }
}

/**
 * Associate subsequent events with a signed-in user, keyed on email (the join
 * key shared with the website). Skips when email is absent so the person stays
 * anonymous rather than being keyed on an unstable id.
 */
export function identifyUser(user: {
  id?: string | number | null;
  email?: string | null;
  username?: string | null;
}): void {
  if (!client) return;
  if (!user.email) return;
  try {
    client.identify(user.email, {
      email: user.email,
      user_id: user.id ?? undefined,
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
 * Explicit helper for tracking a feature button / action per surface (MCP,
 * skills, triggers, multi-agent, file generation, …). Autocapture already
 * records raw clicks, but a named event is what the feature-adoption analysis
 * needs and is easy to chart.
 */
export function trackFeature(
  feature: string,
  properties?: Record<string, unknown>
): void {
  capture('feature_used', { feature, ...properties });
}

/**
 * Record that a user submitted a task. Emits `task_submitted` always, plus a
 * dedicated `first_task_started` (with the elapsed time since the app opened)
 * the first time a given install submits a task — that's the metric for
 * "how long does it take a user to start their first task".
 */
export function trackTaskSubmitted(properties?: Record<string, unknown>): void {
  const secondsSinceAppOpen = (Date.now() - appOpenedAt) / 1000;
  const hasSubmittedBefore = readFlag(HAS_SUBMITTED_TASK_KEY);
  const isFirstTaskThisSession = !firstSubmitCapturedThisSession;
  firstSubmitCapturedThisSession = true;

  capture('task_submitted', {
    ...properties,
    is_first_task_ever: !hasSubmittedBefore,
    is_first_task_this_session: isFirstTaskThisSession,
    seconds_since_app_open: round(secondsSinceAppOpen),
  });

  if (!hasSubmittedBefore) {
    capture('first_task_started', {
      ...properties,
      seconds_since_app_open: round(secondsSinceAppOpen),
    });
    writeFlag(HAS_SUBMITTED_TASK_KEY);
  }
}

/**
 * Record that a task finished successfully. Emits `task_completed` always, plus
 * `first_task_completed` (with elapsed time since app open) the first time an
 * install ever completes a task — the "time to value" milestone.
 */
export function trackTaskCompleted(properties?: Record<string, unknown>): void {
  const secondsSinceAppOpen = (Date.now() - appOpenedAt) / 1000;
  const hasCompletedBefore = readFlag(HAS_COMPLETED_TASK_KEY);

  capture('task_completed', {
    ...properties,
    is_first_completion_ever: !hasCompletedBefore,
  });

  if (!hasCompletedBefore) {
    capture('first_task_completed', {
      ...properties,
      seconds_since_app_open: round(secondsSinceAppOpen),
    });
    writeFlag(HAS_COMPLETED_TASK_KEY);
  }
}

/**
 * Bucket a raw task/runtime error message into a small, stable taxonomy so the
 * `error_type` property stays chart-friendly instead of high-cardinality.
 */
export function classifyError(message?: string | null): string {
  if (!message) return 'unknown';
  const m = message.toLowerCase();
  if (m.includes('backend') && (m.includes('ready') || m.includes('not')))
    return 'backend_unavailable';
  if (m.includes('already processing')) return 'single_agent_busy';
  if (m.includes('credit') || m.includes('usage limit') || m.includes('quota'))
    return 'credits_or_limit';
  if (m.includes('model')) return 'model';
  if (m.includes('mcp') || m.includes('tool') || m.includes('toolkit'))
    return 'tool_or_mcp';
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch'))
    return 'network';
  return 'unknown';
}

/**
 * Classify "what job is Eigent hired for" entirely on-device, returning a
 * low-cardinality `task_category` enum. The raw project name / summary is read
 * here but NEVER sent to PostHog — only the resulting label leaves the machine,
 * which keeps user task content private and the property chart-friendly.
 *
 * This is a deliberately simple keyword heuristic — first match wins, ordered
 * from most distinctive to least. Refine the buckets/keywords as needed.
 */
const TASK_CATEGORY_RULES: Array<[string, RegExp]> = [
  [
    'coding',
    /\b(code|coding|bug|debug|refactor|api|repo|git|deploy|compile|script|function|python|javascript|typescript)\b/,
  ],
  [
    'data_analysis',
    /\b(data|csv|excel|spreadsheet|dataset|sql|chart|graph|statistic|analy)/,
  ],
  [
    'web_automation',
    /\b(browse|browser|website|web page|navigate|crawl|scrape|fill.*form|automate)/,
  ],
  [
    'document',
    /\b(pdf|document|\bdoc\b|slide|presentation|ppt|word file|convert.*file)/,
  ],
  ['communication', /\b(email|slack|message|notify|calendar|meeting|invite)\b/],
  [
    'design',
    /\b(design|logo|figma|mockup|diagram|wireframe|image|illustration)\b/,
  ],
  [
    'writing',
    /\b(write|blog|article|essay|draft|post|copywrit|content|translate|summari[sz]e)/,
  ],
  [
    'research',
    /\b(research|find|search|investigate|gather|compare|look up|report on)/,
  ],
];

export function classifyTaskCategory(text?: string | null): string {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  for (const [category, pattern] of TASK_CATEGORY_RULES) {
    if (pattern.test(t)) return category;
  }
  return 'other';
}

function detectChannel(): 'web' | 'desktop' {
  // Electron exposes ipcRenderer on window; web does not.
  return typeof window !== 'undefined' && (window as any).ipcRenderer
    ? 'desktop'
    : 'web';
}

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, 'true');
  } catch {
    // localStorage unavailable — degrade silently.
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
