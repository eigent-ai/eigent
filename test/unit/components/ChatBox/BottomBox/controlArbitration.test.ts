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

import { selectBottomBoxControl } from '@/components/ChatBox/BottomBox/controlArbitration';
import type {
  BottomBoxApprovalVariant,
  BottomBoxInputVariant,
  BottomBoxRunControlVariant,
} from '@/components/ChatBox/BottomBox/types';
import { describe, expect, it, vi } from 'vitest';

function approvalVariant(): BottomBoxApprovalVariant {
  return {
    kind: 'approval',
    header: { title: 'Allow this action?' },
    options: [{ scope: 'once', label: 'Approve once' }],
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };
}

function runControlVariant(): BottomBoxRunControlVariant {
  return {
    kind: 'run_control',
    header: { title: 'Run interrupted' },
    runId: 'run-1',
    state: 'interrupted',
    onResume: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('BottomBox control arbitration', () => {
  it('gives a pending human interaction priority over Run controls and the composer', () => {
    const humanInteractionVariant = approvalVariant();
    const selection = selectBottomBoxControl({
      humanInteractionVariant,
      runControlVariant: runControlVariant(),
      composerVariant: 'input',
    });

    expect(selection).toEqual({
      variant: humanInteractionVariant,
      source: 'human_interaction',
      isControlled: true,
    });
  });

  it('gives Run controls priority over the composer', () => {
    const runControl = runControlVariant();
    const selection = selectBottomBoxControl({
      runControlVariant: runControl,
      composerVariant: 'input',
    });

    expect(selection).toEqual({
      variant: runControl,
      source: 'run_control',
      isControlled: true,
    });
  });

  it('preserves a decorated legacy input composer and otherwise uses the normal composer', () => {
    const composerVariant: BottomBoxInputVariant = {
      kind: 'input',
      header: {
        eyebrow: 'Input required',
        title: 'Which output tone should I use?',
      },
    };

    expect(selectBottomBoxControl({ composerVariant })).toEqual({
      variant: composerVariant,
      source: 'composer',
      isControlled: false,
    });
    expect(selectBottomBoxControl({})).toEqual({
      variant: 'input',
      source: 'composer',
      isControlled: false,
    });
  });

  it('uses identical control authority for every event-native timeline style', () => {
    const humanInteractionVariant = approvalVariant();
    const runControl = runControlVariant();
    const styles = ['normal', 'detailed', 'summarised'] as const;

    const selections = styles.map(() =>
      selectBottomBoxControl({
        humanInteractionVariant,
        runControlVariant: runControl,
        composerVariant: 'input',
      })
    );

    expect(selections.map((selection) => selection.variant)).toEqual([
      humanInteractionVariant,
      humanInteractionVariant,
      humanInteractionVariant,
    ]);
    expect(selections.map((selection) => selection.source)).toEqual([
      'human_interaction',
      'human_interaction',
      'human_interaction',
    ]);
  });
});
