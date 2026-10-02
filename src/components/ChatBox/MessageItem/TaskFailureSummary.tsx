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
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import type { TaskFailureFacts } from '@/service/runUsageReconciliation';
import { ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolInputOutputDetails } from './ToolInputOutputDetails';

const MAX_RENDERED_ACTIONS = 100;

/** A Task receipt, never an assistant message or an execution control. */
export function TaskFailureSummary({ facts }: { facts?: TaskFailureFacts }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  if (!facts || facts.finalResponse === 'present') return null;
  const { actions } = facts;
  const noActionsRecorded = facts.actionsVerified && !actions.length;
  return (
    <aside
      data-task-failure-summary
      className="flex min-w-0 flex-col gap-ds-12 rounded-ds-card border border-x border-y border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-ds-card-inset"
    >
      <div className="flex items-start gap-ds-8 text-ds-text-error-strong-default">
        <DsIcon icon={CircleAlert} recipe="main" />
        <DsText as="p" role="base" weight="medium">
          {t(
            facts.terminal === 'timed_out'
              ? 'chat.task-failure-timed-out'
              : facts.finalResponse === 'absent'
                ? 'chat.task-failure-confirmed'
                : 'chat.task-failure-status'
          )}
        </DsText>
      </div>
      {noActionsRecorded && (
        <DsText as="p" role="base" className="text-ds-ink-default-default">
          {t('chat.task-failure-no-actions-recorded')}
        </DsText>
      )}
      {(facts.finalResponse === 'unverified' || !facts.actionsVerified) && (
        <DsText as="p" role="base" className="text-ds-ink-default-default">
          {t('chat.task-failure-unverified')}
        </DsText>
      )}
      {actions.some((action) => action.outcome === 'outcome_unknown') && (
        <DsText as="p" role="base" className="text-ds-ink-default-default">
          {t('chat.task-failure-unknown')}
        </DsText>
      )}
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {t('chat.task-failure-effects')}
      </DsText>
      {!noActionsRecorded && (
        <div>
          <Button
            type="button"
            variant="secondary"
            tone="neutral"
            size="sm"
            className="max-w-full"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            <span
              className="min-w-0 truncate"
              title={t(
                expanded
                  ? 'chat.task-failure-hide-actions'
                  : 'chat.task-failure-view-actions'
              )}
            >
              {t(
                expanded
                  ? 'chat.task-failure-hide-actions'
                  : 'chat.task-failure-view-actions'
              )}
            </span>
          </Button>
        </div>
      )}
      {expanded && (
        <div
          id={detailsId}
          className="flex min-w-0 flex-col gap-ds-stack-related"
        >
          {actions.length ? (
            actions.slice(0, MAX_RENDERED_ACTIONS).map((action) => (
              <section
                key={action.id}
                className="flex min-w-0 flex-col gap-ds-8"
                data-action-outcome={action.outcome}
              >
                <DsText
                  as="h3"
                  role="base"
                  weight="medium"
                  className="break-words text-ds-ink-default-default"
                >
                  {action.title || t('chat.task-failure-action')}
                </DsText>
                <DsText
                  as="p"
                  role="meta"
                  className="text-ds-ink-default-default"
                >
                  {t(`chat.task-failure-outcome-${action.outcome}`)}
                </DsText>
                <ToolInputOutputDetails
                  appearance="code-scroll"
                  description={action.detail}
                  input={action.input}
                  output={action.output}
                />
              </section>
            ))
          ) : (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('chat.task-failure-no-actions')}
            </DsText>
          )}
        </div>
      )}
    </aside>
  );
}
