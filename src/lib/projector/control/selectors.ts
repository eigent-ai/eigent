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
  HumanControlInteraction,
  HumanControlProjectionState,
  SelectHumanControlsOptions,
} from './types';

export function selectHumanControlById(
  state: HumanControlProjectionState,
  interactionId: string
): HumanControlInteraction | null {
  return state.interactionById[interactionId] || null;
}

export function selectHumanControls(
  state: HumanControlProjectionState,
  options: SelectHumanControlsOptions = {}
): HumanControlInteraction[] {
  return state.orderedInteractionIds.flatMap((id) => {
    const interaction = state.interactionById[id];
    if (
      (options.runId && interaction.runId !== options.runId) ||
      (options.statuses && !options.statuses.has(interaction.status)) ||
      (options.interactionTypes &&
        !options.interactionTypes.has(interaction.interactionType))
    ) {
      return [];
    }
    return [interaction];
  });
}

export function selectPendingHumanControls(
  state: HumanControlProjectionState,
  runId?: string
): HumanControlInteraction[] {
  return selectHumanControls(state, {
    runId,
    statuses: new Set(['requested']),
  });
}

/** Oldest unresolved request in durable order, suitable for BottomBox. */
export function selectActiveHumanControl(
  state: HumanControlProjectionState,
  runId?: string
): HumanControlInteraction | null {
  return selectPendingHumanControls(state, runId)[0] || null;
}

export function selectPendingHumanControlCount(
  state: HumanControlProjectionState,
  runId?: string
): number {
  return selectPendingHumanControls(state, runId).length;
}
