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
  BottomBoxInputVariant,
  BottomBoxRunControlVariant,
  BottomBoxVariant,
  LegacyBottomBoxVariant,
} from './types';

type ControlledBottomBoxVariant = Exclude<
  BottomBoxVariant,
  BottomBoxInputVariant
>;

export type BottomBoxControlSource =
  'human_interaction' | 'run_control' | 'composer';

export interface BottomBoxControlSelectionInput {
  /**
   * The authoritative pending human request for the active Run. Event-native
   * callers must pass only the typed durable controller here.
   */
  humanInteractionVariant?: ControlledBottomBoxVariant | null;
  /** Lifecycle controls are considered only when no human response is due. */
  runControlVariant?: BottomBoxRunControlVariant | null;
  /** Normal composer, optionally decorated with a legacy question header. */
  composerVariant?: BottomBoxInputVariant | LegacyBottomBoxVariant | null;
}

export interface BottomBoxControlSelection {
  variant: BottomBoxVariant | LegacyBottomBoxVariant;
  source: BottomBoxControlSource;
  /** Controlled variants replace the normal composer UI. */
  isControlled: boolean;
}

/**
 * Chooses the one control rendered by BottomBox.
 *
 * Timeline presentation is deliberately absent from this contract: Normal,
 * Detailed, and Summarised views share the same control authority and the same
 * mounted BottomBox. The owning container decides whether the durable or
 * legacy human-control adapter is authoritative before calling this helper.
 */
export function selectBottomBoxControl({
  humanInteractionVariant,
  runControlVariant,
  composerVariant,
}: BottomBoxControlSelectionInput): BottomBoxControlSelection {
  if (humanInteractionVariant) {
    return {
      variant: humanInteractionVariant,
      source: 'human_interaction',
      isControlled: true,
    };
  }

  if (runControlVariant) {
    return {
      variant: runControlVariant,
      source: 'run_control',
      isControlled: true,
    };
  }

  return {
    variant: composerVariant ?? 'input',
    source: 'composer',
    isControlled: false,
  };
}
