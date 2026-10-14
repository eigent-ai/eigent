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

import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoxHeaderDisplay } from './BoxHeader';
import { ControlInputRouter } from './ControlInput';
import type { BottomBoxVariant } from './types';

type HumanDecisionVariant = Exclude<
  BottomBoxVariant,
  { kind: 'input' | 'run_control' }
>;

/** One authority for the active request, anchored above the composer. */
export function HumanDecisionCard({
  requestKey,
  variant,
}: {
  requestKey: string | null;
  variant: HumanDecisionVariant | null;
}) {
  const { t } = useTranslation();
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string | null>(requestKey);
  const needsReview = seenKey !== null && reviewedKey !== requestKey;

  useEffect(() => {
    if (!requestKey) return;
    if (seenKey === null) setReviewedKey(requestKey);
    setSeenKey(requestKey);
  }, [requestKey, seenKey]);

  if (!variant || !requestKey) return null;

  return (
    <section
      data-human-decision-card
      data-request-key={requestKey}
      className="mb-3 w-full rounded-3xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default p-3 shadow-ds-elevation-popover"
      role="region"
      aria-label={t('chat.control-region-label')}
      aria-live={variant.kind === 'approval' ? 'assertive' : 'polite'}
    >
      {needsReview ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          buttonRadius="full"
          onClick={() => setReviewedKey(requestKey)}
        >
          {t('chat.control-review-next-request')}
        </Button>
      ) : (
        <>
          <BoxHeaderDisplay
            {...variant.header}
            {...(variant.kind === 'approval'
              ? {
                  description: undefined,
                  contextItems: undefined,
                  details: undefined,
                }
              : {})}
            className="px-0 pt-0"
            descriptionAsTitle={
              variant.kind === 'feedback' && variant.presentation === 'question'
            }
            descriptionAsMarkdown={
              variant.kind === 'feedback' && variant.presentation === 'question'
            }
            showQuestionIcon={
              variant.kind === 'feedback' && variant.presentation === 'question'
            }
          />
          <ControlInputRouter
            variant={
              variant.kind === 'approval' ? { ...variant, header: {} } : variant
            }
            borderlessApproval={variant.kind === 'approval'}
            inputProps={{}}
          />
        </>
      )}
    </section>
  );
}
