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

import type {
  ProjectedArtifact,
  ProjectedLegacyStep,
  ProjectViewState,
} from './types';

const CLOSED_ASK_STEPS = new Set(['end', 'human_reply']);

export function selectRunArtifacts(
  view: ProjectViewState,
  runId: string
): ProjectedArtifact[] {
  return view.artifactsByRun[runId] || [];
}

export function selectPendingLegacyAsk(
  view: ProjectViewState,
  answeredStepIds: ReadonlySet<number | string>
): ProjectedLegacyStep | null {
  const closedRuns = new Set<string>();
  for (let index = view.legacySteps.length - 1; index >= 0; index -= 1) {
    const step = view.legacySteps[index];
    const run = view.runs[step.taskId];
    if (run && run.status !== 'running') {
      closedRuns.add(step.taskId);
      continue;
    }
    if (CLOSED_ASK_STEPS.has(step.step)) {
      closedRuns.add(step.taskId);
      continue;
    }
    if (step.step !== 'ask') {
      continue;
    }
    if (answeredStepIds.has(step.stepId)) {
      closedRuns.add(step.taskId);
      continue;
    }
    if (!closedRuns.has(step.taskId)) {
      return step;
    }
  }
  return null;
}
