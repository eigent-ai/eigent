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
  }
  if (
    next.needsResync &&
    (!previous.needsResync ||
      next.resyncReason !== previous.resyncReason ||
      next.resyncTargetCursor !== previous.resyncTargetCursor)
  ) {
    effects.push({
      type: 'request_resync',
      reason: next.resyncReason || 'unknown_gap',
    });
  }
  return effects;
}
