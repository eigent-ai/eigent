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
  pickWorkspaceWelcomeKey,
  timeOfDayGreetingKey,
} from '@/components/Workspace/welcomeMessage';
import { describe, expect, it } from 'vitest';

const at = (hour: number) => new Date(2026, 10, 13, hour, 30);

describe('workspace welcome', () => {
  it.each([
    [4, 'layout.workspace-welcome-evening'],
    [5, 'layout.workspace-welcome-morning'],
    [11, 'layout.workspace-welcome-morning'],
    [12, 'layout.workspace-welcome-afternoon'],
    [17, 'layout.workspace-welcome-afternoon'],
    [18, 'layout.workspace-welcome-evening'],
    [23, 'layout.workspace-welcome-evening'],
  ])('greets at %i:30 with %s', (hour, key) => {
    expect(timeOfDayGreetingKey(at(hour))).toBe(key);
  });

  it('picks the Cowork line or the greeting at random', () => {
    expect(pickWorkspaceWelcomeKey(at(9), () => 0.2)).toBe(
      'layout.workspace-welcome'
    );
    expect(pickWorkspaceWelcomeKey(at(9), () => 0.8)).toBe(
      'layout.workspace-welcome-morning'
    );
  });
});
