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

import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import type { ProjectedRun } from '@/lib/projector';
import type { ChatProjectionNode } from '@/lib/projector/chat';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { useMemo } from 'react';

const LIVE_RUN_STATUSES = new Set<ProjectedRun['status']>([
  'pending',
  'running',
  'waiting_for_user',
  'cancelling',
]);

export function isProjectSessionRunActive(
  status: ProjectedRun['status']
): boolean {
  return LIVE_RUN_STATUSES.has(status);
}

export interface ProjectSessionRun {
  /** Durable Run identity. `taskId` remains as a UI compatibility alias. */
  runId: string;
  taskId: string;
  status: ProjectedRun['status'];
  nodes: ChatProjectionNode[];
  createdAt: number;
  updatedAt: number;
  isCurrent: boolean;
}

export interface ProjectSessionOverview {
  currentRun: ProjectSessionRun | null;
  historicalRuns: ProjectSessionRun[];
  runs: ProjectSessionRun[];
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNodes(left: ChatProjectionNode, right: ChatProjectionNode) {
  // Callers sort one Run at a time. Its durable sequence is the canonical
  // fact order; wall-clock timestamps are display metadata and may tie or
  // arrive skewed after restore/import.
  return (
    left.runSequence - right.runSequence ||
    timestamp(left.createdAt) - timestamp(right.createdAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function compareRuns(left: ProjectSessionRun, right: ProjectSessionRun) {
  return (
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    right.runId.localeCompare(left.runId)
  );
}

/** Build the SidePanel Run view exclusively from the bounded durable bus. */
export function buildProjectSessionOverview(
  snapshot: ProjectEventStoreSnapshot | null
): ProjectSessionOverview {
  if (!snapshot) {
    return { currentRun: null, historicalRuns: [], runs: [] };
  }

  const nodesByRun = new Map<string, ChatProjectionNode[]>();
  for (const node of snapshot.chat.nodes) {
    const nodes = nodesByRun.get(node.runId) ?? [];
    nodes.push(node);
    nodesByRun.set(node.runId, nodes);
  }

  const runIds = new Set([
    ...Object.keys(snapshot.view.runs),
    ...nodesByRun.keys(),
  ]);
  const runs = [...runIds].map<ProjectSessionRun>((runId) => {
    const projectedRun = snapshot.view.runs[runId];
    const nodes = [...(nodesByRun.get(runId) ?? [])].sort(compareNodes);
    const nodeTimes = nodes
      .map((node) => timestamp(node.createdAt))
      .filter((value) => value > 0);
    const aggregateTime = timestamp(projectedRun?.updatedAt);
    const createdAt =
      nodeTimes.length > 0 ? Math.min(...nodeTimes) : aggregateTime;
    const updatedAt = Math.max(aggregateTime, ...nodeTimes, createdAt);

    return {
      runId,
      taskId: runId,
      status: projectedRun?.status ?? 'unknown',
      nodes,
      createdAt,
      updatedAt,
      isCurrent: false,
    };
  });

  runs.sort(compareRuns);
  const current =
    runs
      .filter((run) => isProjectSessionRunActive(run.status))
      .sort(compareRuns)[0] ??
    runs[0] ??
    null;
  const normalizedRuns = runs.map((run) => ({
    ...run,
    isCurrent: run.runId === current?.runId,
  }));
  const currentRun =
    normalizedRuns.find((run) => run.isCurrent) ?? current ?? null;

  return {
    currentRun,
    historicalRuns: normalizedRuns.filter((run) => !run.isCurrent),
    runs: normalizedRuns,
  };
}

/**
 * Project-level SidePanel view backed by the SQLite journal projection.
 * ChatStore is intentionally not consulted here.
 */
export function useProjectSessionOverview(
  projectId: string | null | undefined
): ProjectSessionOverview {
  const runtime = useProjectEventRuntime();
  const snapshot =
    projectId && runtime.projectId === projectId ? runtime.snapshot : null;
  return useMemo(() => buildProjectSessionOverview(snapshot), [snapshot]);
}
