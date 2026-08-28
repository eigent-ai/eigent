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

import { createLegacyApprovalVariant } from '@/components/ChatBox/BottomBox/legacyHumanControl';
import enUsChat from '@/i18n/locales/en-us/chat.json';
import type { HumanInteractionPayload } from '@/service/humanInteractionApi';
import { describe, expect, it, vi } from 'vitest';

/** Resolve against the shipped English bundle so missing keys fail loudly. */
const t = (key: string) => {
  const value = (enUsChat as Record<string, string>)[
    key.replace(/^chat\./, '')
  ];
  if (typeof value !== 'string') throw new Error(`Missing copy for ${key}`);
  return value;
};

const approval: HumanInteractionPayload = {
  interaction_id: 'approval-1',
  interaction_type: 'approval',
  run_id: 'run-1',
  question: 'The agent wants to write files.',
};

describe('legacy BottomBox human control', () => {
  it('turns a legacy approval into the approval variant with a safe once default', () => {
    const variant = createLegacyApprovalVariant({
      interaction: approval,
      fallbackQuestion: 'Fallback question',
      t,
      onApprove: vi.fn(),
      onReject: vi.fn(),
    });

    expect(variant).toMatchObject({
      kind: 'approval',
      header: {
        eyebrow: 'Input required',
        title: 'The agent wants to write files.',
      },
      options: [{ scope: 'once', label: 'Approve once' }],
    });
  });

  it('preserves offered approval scopes and delegates decisions', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const variant = createLegacyApprovalVariant({
      interaction: {
        ...approval,
        allowed_scopes: ['once', 'space'],
      },
      submitting: true,
      t,
      onApprove,
      onReject,
    });

    expect(variant?.submitting).toBe(true);
    expect(variant?.options).toEqual([
      {
        scope: 'once',
        label: 'Approve once',
        description: 'Allow this action one time.',
      },
      {
        scope: 'space',
        label: 'Always allow',
        description:
          'Allow this action in this Space from now on, including future tasks.',
      },
    ]);
    variant?.onApprove('space');
    variant?.onReject();
    expect(onApprove).toHaveBeenCalledWith('space');
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('leaves ordinary questions in the composer path', () => {
    expect(
      createLegacyApprovalVariant({
        interaction: { ...approval, interaction_type: 'question' },
        t,
        onApprove: vi.fn(),
        onReject: vi.fn(),
      })
    ).toBeNull();
  });
});
