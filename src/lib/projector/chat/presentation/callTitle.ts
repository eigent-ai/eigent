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

import i18next from 'i18next';
import type { ChatActivityStatus } from '../types';
import type { TimelineCall } from './timelineCalls';
import type { TimelineActionKind } from './types';

/** Where a call is in its life, as its title tells it. */
export type TimelineCallPhase = 'running' | 'done' | 'failed' | 'stopped';

/**
 * `outcome_unknown` and `unknown` have no phase: the call may have done its
 * work, so a title must not claim either success or failure.
 */
export function timelineCallPhase(
  status: ChatActivityStatus
): TimelineCallPhase | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'cancelled':
    case 'blocked':
    case 'interrupted':
      return 'stopped';
    default:
      return null;
  }
}

type TitleKind = Exclude<TimelineActionKind, 'subagent'>;

/**
 * One whole sentence per action and phase, so each locale keeps its own word
 * order. `target` variants take the call's subject (a query, a command, a
 * path); `generic` names the toolkit instead of guessing a verb for it.
 */
const TITLE_KEYS: Record<
  TitleKind,
  Record<TimelineCallPhase, { plain: string; target?: string }>
> = {
  search: {
    running: {
      plain: 'chat.call-title-search-running',
      target: 'chat.call-title-search-running-target',
    },
    done: {
      plain: 'chat.call-title-search-done',
      target: 'chat.call-title-search-done-target',
    },
    failed: {
      plain: 'chat.call-title-search-failed',
      target: 'chat.call-title-search-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-search-stopped',
      target: 'chat.call-title-search-stopped-target',
    },
  },
  inspect: {
    running: {
      plain: 'chat.call-title-inspect-running',
      target: 'chat.call-title-inspect-running-target',
    },
    done: {
      plain: 'chat.call-title-inspect-done',
      target: 'chat.call-title-inspect-done-target',
    },
    failed: {
      plain: 'chat.call-title-inspect-failed',
      target: 'chat.call-title-inspect-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-inspect-stopped',
      target: 'chat.call-title-inspect-stopped-target',
    },
  },
  edit: {
    running: {
      plain: 'chat.call-title-edit-running',
      target: 'chat.call-title-edit-running-target',
    },
    done: {
      plain: 'chat.call-title-edit-done',
      target: 'chat.call-title-edit-done-target',
    },
    failed: {
      plain: 'chat.call-title-edit-failed',
      target: 'chat.call-title-edit-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-edit-stopped',
      target: 'chat.call-title-edit-stopped-target',
    },
  },
  write: {
    running: {
      plain: 'chat.call-title-write-running',
      target: 'chat.call-title-write-running-target',
    },
    done: {
      plain: 'chat.call-title-write-done',
      target: 'chat.call-title-write-done-target',
    },
    failed: {
      plain: 'chat.call-title-write-failed',
      target: 'chat.call-title-write-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-write-stopped',
      target: 'chat.call-title-write-stopped-target',
    },
  },
  command: {
    running: {
      plain: 'chat.call-title-command-running',
      target: 'chat.call-title-command-running-target',
    },
    done: {
      plain: 'chat.call-title-command-done',
      target: 'chat.call-title-command-done-target',
    },
    failed: {
      plain: 'chat.call-title-command-failed',
      target: 'chat.call-title-command-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-command-stopped',
      target: 'chat.call-title-command-stopped-target',
    },
  },
  browse: {
    running: {
      plain: 'chat.call-title-browse-running',
      target: 'chat.call-title-browse-running-target',
    },
    done: {
      plain: 'chat.call-title-browse-done',
      target: 'chat.call-title-browse-done-target',
    },
    failed: {
      plain: 'chat.call-title-browse-failed',
      target: 'chat.call-title-browse-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-browse-stopped',
      target: 'chat.call-title-browse-stopped-target',
    },
  },
  plan: {
    running: { plain: 'chat.call-title-plan-running' },
    done: { plain: 'chat.call-title-plan-done' },
    failed: { plain: 'chat.call-title-plan-failed' },
    stopped: { plain: 'chat.call-title-plan-stopped' },
  },
  message: {
    running: { plain: 'chat.call-title-message-running' },
    done: { plain: 'chat.call-title-message-done' },
    failed: { plain: 'chat.call-title-message-failed' },
    stopped: { plain: 'chat.call-title-message-stopped' },
  },
  generic: {
    running: {
      plain: 'chat.call-title-generic-running',
      target: 'chat.call-title-generic-running-target',
    },
    done: {
      plain: 'chat.call-title-generic-done',
      target: 'chat.call-title-generic-done-target',
    },
    failed: {
      plain: 'chat.call-title-generic-failed',
      target: 'chat.call-title-generic-failed-target',
    },
    stopped: {
      plain: 'chat.call-title-generic-stopped',
      target: 'chat.call-title-generic-stopped-target',
    },
  },
};

export interface TimelineCallTitle {
  text: string;
  /**
   * The title already says the call's status in words, so the row does not
   * repeat a status word after it.
   */
  statesStatus: boolean;
  /** The text is this frontend's outcome-tense phrase, not authored copy. */
  outcomeTense: boolean;
}

interface TimelineCallTitleOptions {
  /** Short display-safe request subject: a query, a command, or a path. */
  subject?: string | null;
  /** Short display-safe description the toolkit wrote for this call. */
  description?: string | null;
}

type TitledCall = Pick<
  TimelineCall,
  'executor' | 'actionKind' | 'status' | 'title' | 'toolkitName' | 'methodName'
>;

function identity(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * True when the title is only the projection's toolkit/method fallback.
 * A `display_title` or legacy `title` the backend sent is authored copy and
 * keeps its own wording.
 */
function isFallbackTitle(call: TitledCall): boolean {
  const title = identity(call.title);
  if (!title) return true;
  const toolkit = identity(call.toolkitName);
  const method = identity(call.methodName);
  return [toolkit, toolkit.replace(/toolkit$/, ''), method, toolkit + method]
    .filter(Boolean)
    .includes(title);
}

function joinTitle(title: string, extra: string | null | undefined): string {
  return extra ? `${title} · ${extra}` : title;
}

/**
 * The row title for one call, in the tense of its outcome: "Running npm
 * test", "Ran npm test", "Failed to run npm test".
 *
 * Only a fallback title is rewritten. Human calls, authored titles, and a
 * description the toolkit wrote keep their own grammar, which this frontend
 * must not re-tense; a search still prefers its query over a description.
 */
export function timelineCallTitle(
  call: TitledCall,
  { subject = null, description = null }: TimelineCallTitleOptions = {}
): TimelineCallTitle {
  const summary =
    call.actionKind === 'search'
      ? (subject ?? description)
      : (description ?? subject);
  if (call.executor === 'human') {
    return {
      text: joinTitle(call.title, summary),
      statesStatus: true,
      outcomeTense: false,
    };
  }

  const phase = timelineCallPhase(call.status);
  if (!phase || !isFallbackTitle(call)) {
    return {
      text: joinTitle(call.title, summary),
      statesStatus: false,
      outcomeTense: false,
    };
  }
  if (summary && summary === description) {
    return { text: description, statesStatus: false, outcomeTense: false };
  }

  const kind: TitleKind =
    call.actionKind === 'subagent' ? 'generic' : call.actionKind;
  const keys = TITLE_KEYS[kind][phase];
  const key = subject && keys.target ? keys.target : keys.plain;
  return {
    text: i18next.t(key, {
      target: subject,
      tool: call.toolkitName?.trim() || call.title,
    }),
    statesStatus: call.status === 'failed',
    outcomeTense: true,
  };
}
