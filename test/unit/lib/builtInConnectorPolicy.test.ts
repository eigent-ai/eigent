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

import { shouldExposeBuiltInConnector } from '@/lib/builtInConnectorPolicy';
import { describe, expect, it } from 'vitest';

describe('shouldExposeBuiltInConnector', () => {
  it('hides built-in Slack when Connector Gateway owns the runtime', () => {
    expect(shouldExposeBuiltInConnector('Slack', true)).toBe(false);
    expect(shouldExposeBuiltInConnector(' slack ', true)).toBe(false);
  });

  it('keeps built-in Slack available for local-only runtimes', () => {
    expect(shouldExposeBuiltInConnector('Slack', false)).toBe(true);
  });

  it('does not hide unrelated built-in connectors', () => {
    expect(shouldExposeBuiltInConnector('Google Calendar', true)).toBe(true);
    expect(shouldExposeBuiltInConnector('Notion', true)).toBe(true);
  });
});
