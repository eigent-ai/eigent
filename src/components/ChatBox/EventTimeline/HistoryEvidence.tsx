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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { useTranslation } from 'react-i18next';

/** Read-only evidence, separate from input receipts and live controls. */
export function HistoryEvidence({
  entries,
}: {
  entries: readonly { id: string; content: string }[];
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    <Accordion type="single" collapsible data-history-evidence>
      <AccordionItem
        value="history-evidence"
        className="border-ds-hairline-subtle-default"
      >
        <AccordionTrigger
          className={`${DS_FOCUS_RING} text-ds-ink-muted-default`}
        >
          <DsText as="span" role="base" weight="medium">
            {t('chat.history-evidence', { count: entries.length })}
          </DsText>
        </AccordionTrigger>
        <AccordionContent className="flex min-w-0 flex-col gap-ds-stack-related pb-ds-12">
          <DsText role="base" className="text-ds-ink-muted-default">
            {t('chat.history-evidence-description')}
          </DsText>
          <ol className="m-0 flex list-none flex-col gap-ds-stack-related p-0">
            {entries.map((entry) => (
              <li key={entry.id} data-history-evidence-id={entry.id}>
                <DsText
                  role="base"
                  className="break-words whitespace-pre-wrap text-ds-ink-default-default"
                >
                  {entry.content}
                </DsText>
              </li>
            ))}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
