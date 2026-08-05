import type {
  CanonicalProjectEvent,
  ProjectorEffect,
  ProjectorMode,
  ProjectViewState,
} from './types';

export function deriveLiveEffects(
  previous: ProjectViewState,
  next: ProjectViewState,
  event: CanonicalProjectEvent,
  mode: ProjectorMode
): ProjectorEffect[] {
  if (mode !== 'live' || previous.seenEventIds[event.eventId]) {
    return [];
  }
  const effects: ProjectorEffect[] = [];
  if (next.seenEventIds[event.eventId]) {
    effects.push({ type: 'scroll_to_latest', eventId: event.eventId });
    const run = next.runs[event.runId];
    if (run && run.status !== 'running') {
      effects.push({
        type: 'notify_terminal',
        eventId: event.eventId,
        runId: event.runId,
        status: run.status,
      });
    }
  }
  if (next.needsResync && !previous.needsResync) {
    effects.push({
      type: 'request_resync',
      reason: next.resyncReason || 'unknown_gap',
    });
  }
  return effects;
}
