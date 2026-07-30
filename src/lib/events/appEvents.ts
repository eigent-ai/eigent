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

export interface UserIdentity {
  // This may include an email address so edition adapters can decide how to
  // identify a signed-in user. The OSS build only keeps it in this bounded
  // in-memory event buffer; it is not sent anywhere without an adapter.
  id?: string | number | null;
  email?: string | null;
  username?: string | null;
}

export interface TaskOutcomeEventProperties extends Record<string, unknown> {
  session_mode?: unknown;
  agent_count?: number;
  has_mcp?: boolean;
  duration_seconds?: number;
  tokens?: number;
  task_category?: string;
}

export interface AppEventMap {
  app_launch_failed: { reason: string };
  onboarding_step_completed: {
    step_id: string | number;
    step_name?: string;
    phase?: string;
  };
  signin_failed: { reason: string; method: string };
  signup_failed: { reason: string };
  permission_resolved: { permission: string; granted: boolean };
  feature_used: {
    feature: string;
    action?: string;
    [key: string]: unknown;
  };
  mcp_installed: { mcp_id: number; mcp_key?: string };
  mcp_install_failed: {
    mcp_id: number;
    mcp_key?: string;
    error_type: string;
    error_name: string;
  };
  scheduled_trigger_created: {
    trigger_type?: unknown;
    schedule?: unknown;
    is_single_execution?: unknown;
  };
  model_type_changed: { from: string; to: string };
  model_configured: { model_type: string; model_id?: string };
  task_submitted: {
    session_mode?: unknown;
    task_source?: string;
    agent_count?: number;
    has_mcp?: boolean;
  };
  task_failed: {
    error_type: string;
    is_project_busy?: boolean;
    session_mode?: unknown;
  };
  task_stopped: TaskOutcomeEventProperties & { stop_reason: string };
  task_completed: TaskOutcomeEventProperties;
  file_generated: { count: number };
  user_identity_available: UserIdentity;
  user_session_cleared: Record<string, never>;
}

export type AppEventName = keyof AppEventMap;
export type AppEvent<K extends AppEventName = AppEventName> = {
  [Name in AppEventName]: {
    name: Name;
    properties: AppEventMap[Name];
    timestamp: number;
  };
}[K];
export type AppEventListener = (event: AppEvent) => void;

const listeners = new Set<AppEventListener>();
const bufferedEvents: AppEvent[] = [];
const MAX_BUFFERED_EVENTS = 100;
let shouldBufferEvents = true;

export function emitAppEvent<K extends AppEventName>(
  name: K,
  properties: AppEventMap[K]
): void {
  const event = {
    name,
    properties,
    timestamp: Date.now(),
  } as AppEvent<K>;

  if (shouldBufferEvents) {
    bufferedEvents.push(event as AppEvent);
    if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
      bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS);
    }
  }

  for (const listener of listeners) {
    dispatchAppEvent(listener, event as AppEvent);
  }
}

export function subscribeAppEvents(
  listener: AppEventListener,
  options: { replayBuffered?: boolean; consumeBuffered?: boolean } = {}
): () => void {
  listeners.add(listener);

  if (options.replayBuffered && bufferedEvents.length > 0) {
    const replay = options.consumeBuffered
      ? bufferedEvents.splice(0, bufferedEvents.length)
      : [...bufferedEvents];
    if (options.consumeBuffered) {
      shouldBufferEvents = false;
    }
    for (const event of replay) {
      dispatchAppEvent(listener, event);
    }
  } else if (options.consumeBuffered) {
    shouldBufferEvents = false;
  }

  return () => {
    listeners.delete(listener);
  };
}

function dispatchAppEvent(listener: AppEventListener, event: AppEvent): void {
  try {
    listener(event);
  } catch (error) {
    console.error(`[appEvents] listener failed for ${event.name}:`, error);
  }
}

export function recordUserIdentityAvailable(identity: UserIdentity): void {
  emitAppEvent('user_identity_available', identity);
}

export function recordUserSessionCleared(): void {
  emitAppEvent('user_session_cleared', {});
}

export function recordAppLaunchFailed(reason: string): void {
  emitAppEvent('app_launch_failed', { reason });
}

export function recordOnboardingStepCompleted(
  properties: AppEventMap['onboarding_step_completed']
): void {
  emitAppEvent('onboarding_step_completed', properties);
}

export function recordSignInFailed(
  properties: AppEventMap['signin_failed']
): void {
  emitAppEvent('signin_failed', properties);
}

export function recordSignUpFailed(reason: string): void {
  emitAppEvent('signup_failed', { reason });
}

export function recordPermissionResolved(
  properties: AppEventMap['permission_resolved']
): void {
  emitAppEvent('permission_resolved', properties);
}

export function recordFeatureUsed(
  feature: string,
  properties?: Omit<AppEventMap['feature_used'], 'feature'>
): void {
  emitAppEvent('feature_used', { feature, ...properties });
}

export function recordMcpInstalled(
  properties: AppEventMap['mcp_installed']
): void {
  emitAppEvent('mcp_installed', properties);
}

export function recordMcpInstallFailed(
  properties: AppEventMap['mcp_install_failed']
): void {
  emitAppEvent('mcp_install_failed', properties);
}

export function recordScheduledTriggerCreated(
  properties: AppEventMap['scheduled_trigger_created']
): void {
  emitAppEvent('scheduled_trigger_created', properties);
}

export function recordModelTypeChanged(
  properties: AppEventMap['model_type_changed']
): void {
  emitAppEvent('model_type_changed', properties);
}

export function recordModelConfigured(
  properties: AppEventMap['model_configured']
): void {
  emitAppEvent('model_configured', properties);
}

export function recordTaskSubmitted(
  properties: AppEventMap['task_submitted'] = {}
): void {
  emitAppEvent('task_submitted', properties);
}

export function recordTaskFailed(properties: AppEventMap['task_failed']): void {
  emitAppEvent('task_failed', properties);
}

export function recordTaskStopped(
  properties: AppEventMap['task_stopped']
): void {
  emitAppEvent('task_stopped', properties);
}

export function recordTaskCompleted(
  properties: AppEventMap['task_completed'] = {}
): void {
  emitAppEvent('task_completed', properties);
}

export function recordFileGenerated(count: number): void {
  emitAppEvent('file_generated', { count });
}
