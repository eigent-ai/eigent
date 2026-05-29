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

import { mergeTaggedAgentLogs } from '@/components/ChatBox/taskLog/TaskWorkLogAccordion';
import type { WorkLogCursor } from '@/store/chatStore';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkEntry(
  step = AgentStep.AGENT_MESSAGE,
  content = 'log entry'
): AgentMessage {
  return { step, data: { content } };
}

function mkAgent(id: string, log: AgentMessage[] = []): Agent {
  return {
    agent_id: id,
    type: 'browser_agent',
    name: id,
    status: 'running',
    log,
  } as unknown as Agent;
}

// ---------------------------------------------------------------------------
// No cursor arguments — returns full log
// ---------------------------------------------------------------------------

describe('mergeTaggedAgentLogs — no cursors', () => {
  it('returns empty array when taskAssigning is undefined', () => {
    expect(mergeTaggedAgentLogs(undefined)).toEqual([]);
  });

  it('returns empty array when taskAssigning is empty', () => {
    expect(mergeTaggedAgentLogs([])).toEqual([]);
  });

  it('returns all log entries for a single agent', () => {
    const logs = [mkEntry(), mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const result = mergeTaggedAgentLogs(agents);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.agentId === 'a')).toBe(true);
  });

  it('merges entries from multiple agents in order', () => {
    const logsA = [mkEntry(), mkEntry()];
    const logsB = [mkEntry(), mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logsA), mkAgent('b', logsB)];
    const result = mergeTaggedAgentLogs(agents);
    expect(result).toHaveLength(5);
    expect(result.slice(0, 2).every((r) => r.agentId === 'a')).toBe(true);
    expect(result.slice(2).every((r) => r.agentId === 'b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startCursor only — active group (no endCursor)
// ---------------------------------------------------------------------------

describe('mergeTaggedAgentLogs — startCursor only (active group)', () => {
  it('skips log entries before the cursor', () => {
    const logs = [mkEntry(), mkEntry(), mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = { a: 2 };
    const result = mergeTaggedAgentLogs(agents, startCursor);
    expect(result).toHaveLength(2);
  });

  it('startCursor === log.length → returns empty (no new entries yet)', () => {
    const logs = [mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = { a: 2 };
    expect(mergeTaggedAgentLogs(agents, startCursor)).toHaveLength(0);
  });

  it('startCursor for unknown agent defaults to 0 (full log)', () => {
    const logs = [mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = {}; // 'a' not in cursor
    expect(mergeTaggedAgentLogs(agents, startCursor)).toHaveLength(2);
  });

  it('active group grows as new log entries are appended', () => {
    const logs = [mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = { a: 1 };

    // Before new entry
    expect(mergeTaggedAgentLogs(agents, startCursor)).toHaveLength(1);

    // Simulate new log entry appended
    logs.push(mkEntry());
    expect(mergeTaggedAgentLogs(agents, startCursor)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// startCursor + endCursor — closed group
// ---------------------------------------------------------------------------

describe('mergeTaggedAgentLogs — startCursor + endCursor (closed group)', () => {
  it('returns only entries in [start, end) range', () => {
    const logs = [mkEntry(), mkEntry(), mkEntry(), mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = { a: 1 };
    const endCursor: WorkLogCursor = { a: 4 };
    const result = mergeTaggedAgentLogs(agents, startCursor, endCursor);
    expect(result).toHaveLength(3);
  });

  it('returns no entries when start === end (empty slice)', () => {
    const logs = [mkEntry(), mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const cursor: WorkLogCursor = { a: 2 };
    expect(mergeTaggedAgentLogs(agents, cursor, cursor)).toHaveLength(0);
  });

  it('agent not in endCursor gets 0 logs (agent appeared after group closed)', () => {
    const logs = [mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = {};
    const endCursor: WorkLogCursor = {}; // 'a' not present → defaults to 0
    expect(mergeTaggedAgentLogs(agents, startCursor, endCursor)).toHaveLength(
      0
    );
  });

  it('closed group stays fixed even when agent log grows later', () => {
    const logs = [mkEntry(), mkEntry()];
    const agents = [mkAgent('a', logs)];
    const startCursor: WorkLogCursor = { a: 0 };
    const endCursor: WorkLogCursor = { a: 2 };

    expect(mergeTaggedAgentLogs(agents, startCursor, endCursor)).toHaveLength(
      2
    );

    // Simulate log growing (task continues in next group)
    logs.push(mkEntry(), mkEntry());
    // Closed group result must not change
    expect(mergeTaggedAgentLogs(agents, startCursor, endCursor)).toHaveLength(
      2
    );
  });

  it('multiple agents with different cursor ranges', () => {
    const logsA = [mkEntry(), mkEntry(), mkEntry()]; // 3 entries, group saw [0,2)
    const logsB = [mkEntry(), mkEntry()]; // 2 entries, group saw [0,2)
    const agents = [mkAgent('a', logsA), mkAgent('b', logsB)];
    const startCursor: WorkLogCursor = { a: 0, b: 0 };
    const endCursor: WorkLogCursor = { a: 2, b: 2 };
    const result = mergeTaggedAgentLogs(agents, startCursor, endCursor);
    expect(result).toHaveLength(4);
    expect(result.filter((r) => r.agentId === 'a')).toHaveLength(2);
    expect(result.filter((r) => r.agentId === 'b')).toHaveLength(2);
  });
});
