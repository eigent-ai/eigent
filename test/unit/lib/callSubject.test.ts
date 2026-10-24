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
  callDescription,
  callSubject,
} from '@/lib/projector/chat/presentation';
import { describe, expect, it } from 'vitest';

describe('callSubject', () => {
  it('keeps plain request text and strips known prefixes', () => {
    expect(callSubject({ actionKind: 'command', input: '$ npm test' })).toBe(
      'npm test'
    );
    expect(
      callSubject({ actionKind: 'search', input: 'query: Eigent timeline' })
    ).toBe('Eigent timeline');
  });

  it('reads the named field from JSON requests', () => {
    expect(
      callSubject({
        actionKind: 'search',
        input: '{"query":"Eigent timeline","limit":5}',
      })
    ).toBe('Eigent timeline');
    expect(
      callSubject({ actionKind: 'browse', input: '{"url":"https://a.test"}' })
    ).toBe('https://a.test');
    expect(
      callSubject({ actionKind: 'plan', input: '{"todo":"one"}' })
    ).toBeNull();
  });

  it('reads toolkit argument text without showing the raw arguments', () => {
    expect(
      callSubject({
        actionKind: 'command',
        input: "command='npm test', timeout=30",
      })
    ).toBe('npm test');
    expect(
      callSubject({
        actionKind: 'search',
        input: 'query="it\'s new", num_results=5',
      })
    ).toBe("it's new");
    expect(
      callSubject({ actionKind: 'inspect', input: "'src/index.ts'" })
    ).toBe('src/index.ts');
    expect(
      callSubject({
        actionKind: 'command',
        input: "cwd='/tmp', env={'A': '1'}",
      })
    ).toBeNull();
  });

  it('never promotes credential-like or multi-line text', () => {
    expect(
      callSubject({
        actionKind: 'command',
        input: "command='export API_KEY=x'",
      })
    ).toBeNull();
    expect(
      callSubject({ actionKind: 'command', input: "command='a\\nb'" })
    ).toBeNull();
  });
});

describe('callDescription', () => {
  it.each([
    'Outcome unknown after 17 s',
    'Completed in 465 ms',
    'Prepared',
    'Stopped after 5 s',
  ])('omits lifecycle-only detail %s from row titles', (detail) => {
    expect(callDescription({ detail })).toBeNull();
  });

  it('keeps a toolkit work description', () => {
    expect(callDescription({ detail: 'Fetching Anthropic news page' })).toBe(
      'Fetching Anthropic news page'
    );
  });
});
