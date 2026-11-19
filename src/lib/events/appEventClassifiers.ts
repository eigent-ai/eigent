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

/**
 * Bucket raw runtime errors into a small, stable taxonomy. The raw message may
 * include local paths, command output, or user content, so callers should emit
 * only this low-cardinality label.
 */
export function classifyError(message?: string | null): string {
  if (!message) return 'unknown';
  const m = message.toLowerCase();
  if (m.includes('backend') && (m.includes('ready') || m.includes('not')))
    return 'backend_unavailable';
  if (m.includes('already processing')) return 'single_agent_busy';
  if (m.includes('credit') || m.includes('usage limit') || m.includes('quota'))
    return 'credits_or_limit';
  if (m.includes('model')) return 'model';
  if (m.includes('mcp') || m.includes('tool') || m.includes('toolkit'))
    return 'tool_or_mcp';
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch'))
    return 'network';
  return 'unknown';
}

/**
 * Classify "what job is Eigent hired for" entirely on-device. The raw project
 * name / summary is read locally but never emitted; only the resulting enum can
 * be forwarded to edition-specific analytics adapters.
 */
const TASK_CATEGORY_RULES: Array<[string, RegExp]> = [
  [
    'coding',
    /\b(code|coding|bug|debug|refactor|api|repo|git|deploy|compile|script|function|python|javascript|typescript)\b/,
  ],
  [
    'data_analysis',
    /\b(data|csv|excel|spreadsheet|dataset|sql|chart|graph|statistic|analy)/,
  ],
  [
    'web_automation',
    /\b(browse|browser|website|web page|navigate|crawl|scrape|fill.*form|automate)/,
  ],
  [
    'document',
    /\b(pdf|document|\bdoc\b|slide|presentation|ppt|word file|convert.*file)/,
  ],
  ['communication', /\b(email|slack|message|notify|calendar|meeting|invite)\b/],
  [
    'design',
    /\b(design|logo|figma|mockup|diagram|wireframe|image|illustration)\b/,
  ],
  [
    'writing',
    /\b(write|blog|article|essay|draft|post|copywrit|content|translate|summari[sz]e)/,
  ],
  [
    'research',
    /\b(research|find|search|investigate|gather|compare|look up|report on)/,
  ],
];

export function classifyTaskCategory(text?: string | null): string {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  for (const [category, pattern] of TASK_CATEGORY_RULES) {
    if (pattern.test(t)) return category;
  }
  return 'other';
}
