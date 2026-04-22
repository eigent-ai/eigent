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

import { useTranslation } from 'react-i18next';

/**
 * First three entries from `starterSuggestions` in ChatBox/index.tsx — keep keys in sync.
 */
const WORKSPACE_EXAMPLE_PROMPTS: readonly {
  id: string;
  titleKey: string;
  titleDefault: string;
  messageKey: string;
  messageDefault: string;
}[] = [
  {
    id: 'it-ticket-creation',
    titleKey: 'layout.it-ticket-creation',
    titleDefault: 'Help me complete an online form',
    messageKey: 'layout.it-ticket-creation-message',
    messageDefault:
      'Access the ticket management system at https://eiti.eigent.ai/ and add a new ticket into our system with Browser Agent:\n\nAffected User: Alice Johnson\nAssignment Group: Software Services Team\nAssigned To: Michael Brown\nPriority: 4 – Low | Urgency: 3 – Medium | Impact: 4 – Low\nAffected Service: Software Services\nIssue: Application Performance Degradation\nDescription:\nThe affected user reports slow response times and intermittent timeouts when accessing internal software applications during normal business hours.\n\nOnce done, navigate to the "In Progress" tickets list view and extract the visible ticket data from the list (Number, User, Priority, State, Issue columns). Use browser console JavaScript to capture the table data if no export button is available. Save the extracted data as a CSV file.\n\nFinally, generate a statistical report based on the extracted data:\n1. Analyze ticket distribution by Priority level (Critical/High/Moderate/Low)\n2. Parse any dollar amounts mentioned in the Issue text (e.g., "$50M", "$3.2M") as estimated financial impact\n3. Create an HTML report with bar charts showing:\n   - Ticket count by Priority\n   - Estimated financial impact by Priority (parsed from Issue text)\nInclude a "Data Notes" section explaining that financial impact values were parsed from Issue description text since no dedicated financial field exists in the system.',
  },
  {
    id: 'bank-transfer-csv-analysis',
    titleKey: 'layout.bank-transfer-csv-analysis',
    titleDefault: 'Bank Transfer CSV Analysis and Visualization',
    messageKey: 'layout.bank-transfer-csv-analysis-message',
    messageDefault:
      'Create a mock bank transfer CSV file include 10 columns and 10 rows. Read the generated CSV file and summarize the data, generate a chart to visualize relevant trends or insights from the data.',
  },
  {
    id: 'find-duplicate-files',
    titleKey: 'layout.find-duplicate-files',
    titleDefault: 'Please Help Organize My Desktop',
    messageKey: 'layout.find-duplicate-files-message',
    messageDefault: 'Please help organize my desktop.',
  },
];

export interface WorkspaceExamplePromptsProps {
  onSelectPrompt: (prompt: string) => void;
  /** When true, cards do not respond to clicks (e.g. no model configured). */
  disabled?: boolean;
}

/**
 * Full-width (max 900px) grid of starter prompt cards for the workspace landing.
 */
export function WorkspaceExamplePrompts({
  onSelectPrompt,
  disabled = false,
}: WorkspaceExamplePromptsProps) {
  const { t } = useTranslation();

  return (
    <div className="pb-4 mx-auto flex min-h-full w-full max-w-[600px] flex-col">
      <div className="gap-5 sm:grid-cols-2 lg:grid-cols-3 grid w-full grid-cols-1">
        {WORKSPACE_EXAMPLE_PROMPTS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              onSelectPrompt(
                t(item.messageKey, { defaultValue: item.messageDefault })
              )
            }
            disabled={disabled}
            className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-strong-default p-3 hover:bg-ds-bg-neutral-strong-default/40 focus-visible:ring-ds-ring-neutral-default-focus border border-solid text-center opacity-50 transition-opacity duration-200 hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
          >
            <span className="text-ds-text-neutral-default-default text-body-sm font-semibold leading-snug block">
              {t(item.titleKey, { defaultValue: item.titleDefault })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
