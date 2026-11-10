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

import type { TimelineCall } from './timelineCalls';
import type { TimelineActionKind } from './types';

/** The request fields that name what a call acts on, by action. */
const SUBJECT_FIELDS: Partial<Record<TimelineActionKind, readonly string[]>> = {
  search: ['query', 'search_query', 'q'],
  command: ['command', 'cmd'],
  inspect: ['path', 'file_path', 'filename'],
  edit: ['path', 'file_path', 'filename'],
  write: ['path', 'file_path', 'filename'],
  browse: ['url'],
};

/** A collapsed row must not promote a long payload or credential-like text. */
export function conciseRowText(value: string | undefined): string | null {
  const text = value?.trim();
  if (
    !text ||
    text.length > 160 ||
    /[\r\n\t{}]/.test(text) ||
    /\b(?:api[_-]?key|access[_-]?token|secret|password|authorization|bearer)\b|(?:^|\s)[\w.-]*(?:KEY|TOKEN|SECRET)=/i.test(
      text
    )
  ) {
    return null;
  }
  return text;
}

interface FormattedArgs {
  /** Positional values that were string literals. */
  positional: string[];
  /** Named string-literal values. */
  named: Record<string, string>;
}

/**
 * Read the `'value', key='value'` argument text a toolkit reports when it has
 * no input formatter. Only string literals are kept; anything else is skipped.
 */
function parseFormattedArgs(input: string): FormattedArgs | null {
  const args: FormattedArgs = { positional: [], named: {} };
  let index = 0;
  const skipSpace = () => {
    while (index < input.length && /\s/.test(input[index]!)) index += 1;
  };

  while (index < input.length) {
    skipSpace();
    let name: string | null = null;
    const named = /^([A-Za-z_]\w*)\s*=/.exec(input.slice(index));
    if (named) {
      name = named[1]!;
      index += named[0].length;
      skipSpace();
    }

    const quote = input[index];
    if (quote === "'" || quote === '"') {
      let value = '';
      index += 1;
      while (index < input.length && input[index] !== quote) {
        if (input[index] === '\\' && index + 1 < input.length) {
          const escaped = input[index + 1]!;
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          index += 2;
        } else {
          value += input[index];
          index += 1;
        }
      }
      if (input[index] !== quote) return null;
      index += 1;
      if (name) args.named[name] = value;
      else args.positional.push(value);
    } else {
      // A non-string value: skip it, respecting nested brackets.
      let depth = 0;
      while (index < input.length) {
        const char = input[index]!;
        if ('([{'.includes(char)) depth += 1;
        else if (')]}'.includes(char)) depth -= 1;
        else if (char === ',' && depth <= 0) break;
        index += 1;
      }
    }

    skipSpace();
    if (index >= input.length) break;
    if (input[index] !== ',') return null;
    index += 1;
  }
  return args;
}

/** Only promote short, display-safe request text to a row. */
export function callSubject(
  call: Pick<TimelineCall, 'input' | 'actionKind'>
): string | null {
  const input = call.input?.trim();
  if (!input || input.length > 1_000 || /^parameters:/i.test(input))
    return null;
  const fields = SUBJECT_FIELDS[call.actionKind] ?? [];

  let subject: string | undefined;
  if (input.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(input);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const values = parsed as Record<string, unknown>;
      subject = fields
        .map((key) => values[key])
        .find((field): field is string => typeof field === 'string');
    } catch {
      return null;
    }
  } else if (/^(?:[A-Za-z_]\w*\s*=|['"])/.test(input)) {
    const parsed = parseFormattedArgs(input);
    if (!parsed) return null;
    subject =
      fields.map((key) => parsed.named[key]).find(Boolean) ??
      (fields.length > 0 && Object.keys(parsed.named).length === 0
        ? parsed.positional[0]
        : undefined);
  } else if (call.actionKind === 'search' && /^with query /i.test(input)) {
    // SearchToolkit's legacy formatter includes options after the query.
    subject = /^with query (['"])(.*)\1, (?:web|image|news|video) type,/i.exec(
      input
    )?.[2];
  } else if (
    call.actionKind === 'write' &&
    /^write content to file:/i.test(input)
  ) {
    subject =
      /^write content to file: (.+) with encoding: \S+ and use_latex: (?:true|false)$/i.exec(
        input
      )?.[1];
  } else {
    subject = input.replace(
      /^(?:search query|query|command|file|path|url):\s*/i,
      ''
    );
  }
  if (!subject) return null;
  if (call.actionKind === 'command') subject = subject.replace(/^\$\s+/, '');
  return conciseRowText(subject);
}

/** The call detail is the human-readable work description, when supplied. */
export function callDescription(
  call: Pick<TimelineCall, 'notice' | 'detail'>
): string | null {
  for (const candidate of [call.notice?.content, call.detail]) {
    const description = conciseRowText(candidate);
    if (
      description &&
      !/^parameters:/i.test(description) &&
      !/^(?:completed|in progress|started|running|failed|cancelled|timed out|stopped|interrupted|prepared|outcome unknown|returned text)(?:[ .:(]|$)/i.test(
        description
      )
    ) {
      return description;
    }
  }
  return null;
}

/** The subject an authored title carries after it in a repeated group. */
export function callSummary(
  call: Pick<TimelineCall, 'input' | 'actionKind' | 'notice' | 'detail'>
): string | null {
  const subject = callSubject(call);
  const description = callDescription(call);
  return call.actionKind === 'search'
    ? (subject ?? description)
    : (description ?? subject);
}
