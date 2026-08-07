import type { ProjectedLegacyStep, ProjectViewState } from './types';

const CLOSED_ASK_STEPS = new Set(['end', 'human_reply']);

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
