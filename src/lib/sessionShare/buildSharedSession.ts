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

import { normalizeEvent, type CanonicalProjectEvent } from '@/lib/projector';

import {
  cleanSharedString,
  cleanSharedValue,
  prepareCleanContext,
  REMOVED,
  type PreparedCleanContext,
} from './cleanSharedValue';

export const SHARED_SESSION_SCHEMA_VERSION = 1;

export interface ShareOptions {
  /** Runs to include, by run id. */
  runIds: readonly string[];
  /** Tool and terminal calls with their results. On by default. */
  includeToolCalls: boolean;
  /** Model reasoning text. Off by default. */
  includeThinking: boolean;
  /** Space-relative paths of files whose contents are included. */
  includedFiles: readonly string[];
}

export interface ShareSourceRun {
  runId: string;
  status: string;
  createdAt: string | null;
  events: readonly CanonicalProjectEvent[];
}

export interface SharedSessionEvent {
  event_id: string;
  sequence: number;
  event_type: string;
  legacy_step: string | null;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface SharedSessionRun {
  /** Position-based key; the Run's real id is not shared. */
  run_key: string;
  status: string;
  created_at: string | null;
  events: SharedSessionEvent[];
}

/** The fixed, cleaned copy uploaded for a share link. */
export interface SharedSessionSnapshot {
  schema_version: typeof SHARED_SESSION_SCHEMA_VERSION;
  title: string;
  runs: SharedSessionRun[];
  included: {
    tool_calls: boolean;
    thinking: boolean;
    files: string[];
  };
}

/** Events that only matter on this device or carry raw model traffic. */
const LOCAL_ONLY_EVENT_TYPES = new Set([
  'run.environment_resolved',
  'run.attempt_environment_bound',
  'run.timeout_policy_configured',
]);
const LOCAL_ONLY_EVENT_PREFIXES = [
  'model.invocation.',
  'permission.action.',
  'admission.',
  'execution.',
  'workspace.writer.',
];
const LOCAL_ONLY_LEGACY_STEPS = new Set([
  'project_metadata',
  'request_usage',
  'sync',
]);

const TOOL_EVENT_PREFIXES = ['tool.', 'terminal.'];
const TOOL_LEGACY_STEPS = new Set([
  'activate_toolkit',
  'deactivate_toolkit',
  'terminal',
]);

const FILE_EVENT_PREFIXES = ['artifact.', 'file.'];
const FILE_LEGACY_STEPS = new Set(['write_file']);
/** Payload fields that can hold a file's contents. */
const FILE_CONTENT_KEYS = new Set([
  'base64',
  'body',
  'content',
  'contents',
  'data',
  'diff',
  'patch',
  'preview',
  'text',
]);

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function isLocalOnly(event: CanonicalProjectEvent): boolean {
  return (
    LOCAL_ONLY_EVENT_TYPES.has(event.eventType) ||
    startsWithAny(event.eventType, LOCAL_ONLY_EVENT_PREFIXES) ||
    (event.legacyStep !== null && LOCAL_ONLY_LEGACY_STEPS.has(event.legacyStep))
  );
}

function isToolEvent(event: CanonicalProjectEvent): boolean {
  return (
    startsWithAny(event.eventType, TOOL_EVENT_PREFIXES) ||
    (event.legacyStep !== null && TOOL_LEGACY_STEPS.has(event.legacyStep))
  );
}

function isFileEvent(event: CanonicalProjectEvent): boolean {
  return (
    startsWithAny(event.eventType, FILE_EVENT_PREFIXES) ||
    (event.legacyStep !== null && FILE_LEGACY_STEPS.has(event.legacyStep))
  );
}

function payloadOf(event: CanonicalProjectEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? event.payload
    : {};
}

function rawFilePath(payload: Record<string, unknown>): string | null {
  for (const key of [
    'relative_path',
    'relativePath',
    'file_path',
    'filePath',
    'path',
  ]) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** The file's path as it appears in the shared copy. */
function sharedFilePath(
  payload: Record<string, unknown>,
  context: PreparedCleanContext
): string | null {
  const raw = rawFilePath(payload);
  if (!raw) return null;
  return cleanSharedString(raw, context).replace(/\\/g, '/');
}

/**
 * Files the agent produced in these Runs, as the paths the owner chooses
 * from. Paths inside the Space folder are relative to it.
 */
export function listShareableFiles(
  runs: readonly ShareSourceRun[],
  spaceRoot: string | null
): string[] {
  const context = prepareCleanContext({ spaceRoot, includeThinking: false });
  const files = new Set<string>();
  for (const run of runs) {
    for (const event of run.events) {
      if (!isFileEvent(event) || isLocalOnly(event)) continue;
      const path = sharedFilePath(payloadOf(event), context);
      if (path) files.add(path);
    }
  }
  return [...files].sort();
}

function withoutFileContents(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !FILE_CONTENT_KEYS.has(key))
  );
}

function toIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

/**
 * Build the cleaned copy of a Session. Pure and deterministic: the same
 * input always gives the same snapshot.
 */
export function buildSharedSession(input: {
  title: string;
  runs: readonly ShareSourceRun[];
  spaceRoot: string | null;
  options: ShareOptions;
}): SharedSessionSnapshot {
  const { options } = input;
  const context = prepareCleanContext({
    spaceRoot: input.spaceRoot,
    includeThinking: options.includeThinking,
  });
  const chosenRuns = new Set(options.runIds);
  const chosenFiles = new Set(
    options.includedFiles.map((path) => path.replace(/\\/g, '/'))
  );
  const includedFiles = new Set<string>();

  const runs = input.runs
    .filter((run) => chosenRuns.has(run.runId))
    .map((run, index): SharedSessionRun => {
      const runKey = `run-${index + 1}`;
      const events: SharedSessionEvent[] = [];
      for (const event of [...run.events].sort(
        (a, b) => a.runSequence - b.runSequence
      )) {
        if (event.runId !== run.runId || isLocalOnly(event)) continue;
        if (!options.includeToolCalls && isToolEvent(event)) continue;
        let payload = payloadOf(event);
        if (isFileEvent(event)) {
          const path = sharedFilePath(payload, context);
          if (path && chosenFiles.has(path)) includedFiles.add(path);
          else payload = withoutFileContents(payload);
        }
        events.push({
          event_id: `${runKey}:${event.runSequence}`,
          sequence: event.runSequence,
          event_type: event.eventType,
          legacy_step: event.legacyStep,
          created_at: toIso(event.createdAt),
          payload: cleanSharedValue(payload, context) as Record<
            string,
            unknown
          >,
        });
      }
      return {
        run_key: runKey,
        status: run.status,
        created_at: run.createdAt ? toIso(run.createdAt) : null,
        events,
      };
    });

  return {
    schema_version: SHARED_SESSION_SCHEMA_VERSION,
    title: cleanSharedString(input.title, context),
    runs,
    included: {
      tool_calls: options.includeToolCalls,
      thinking: options.includeThinking,
      files: [...includedFiles].sort(),
    },
  };
}

/**
 * Turn a snapshot back into projector events, so the preview is drawn from
 * exactly what would be uploaded.
 */
export function sharedSnapshotToEvents(
  snapshot: SharedSessionSnapshot,
  projectId: string
): CanonicalProjectEvent[] {
  const events: CanonicalProjectEvent[] = [];
  for (const run of snapshot.runs) {
    for (const event of run.events) {
      try {
        events.push(
          normalizeEvent({
            event_id: event.event_id,
            project_id: projectId,
            run_id: run.run_key,
            run_sequence: event.sequence,
            run_version: 1,
            event_type: event.event_type,
            legacy_step: event.legacy_step,
            created_at: event.created_at,
            payload: event.payload,
          })
        );
      } catch {
        // An event the projector cannot read is not shown in the preview.
      }
    }
  }
  return events;
}

export { REMOVED };
