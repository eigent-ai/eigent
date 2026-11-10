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
// Licensed under the Apache License, Version 2.0 (the "License");

import type { CanonicalProjectEvent } from '@/lib/projector';

export type RunEventDeliveryMode =
  'live' | 'reconnect_catch_up' | 'historical_rehydrate' | 'cloud_restore';

export type RunEventOrigin = 'local' | 'cloud_restore' | 'remote';

export type RunEventCategory =
  | 'lifecycle'
  | 'approval'
  | 'interaction'
  | 'tool'
  | 'artifact'
  | 'runtime'
  | 'workspace'
  | 'sync'
  | 'memory'
  | 'other';

export type RunDomainEvent = CanonicalProjectEvent & {
  schemaVersion: 1;
  deliveryMode: RunEventDeliveryMode;
  origin: RunEventOrigin;
  category: RunEventCategory;
};

export type RunDomainEventFilter = {
  projectId?: string;
  runId?: string;
  eventTypes?: ReadonlySet<string> | readonly string[];
  categories?: ReadonlySet<RunEventCategory> | readonly RunEventCategory[];
  deliveryModes?:
    ReadonlySet<RunEventDeliveryMode> | readonly RunEventDeliveryMode[];
};

export type RunDomainEventListener = (event: RunDomainEvent) => void;

export function categoryForRunEvent(eventType: string): RunEventCategory {
  if (eventType.startsWith('artifact.')) return 'artifact';
  if (eventType.startsWith('approval.')) return 'approval';
  if (eventType.startsWith('interaction.')) return 'interaction';
  if (eventType.startsWith('tool.')) return 'tool';
  if (eventType.startsWith('runtime.')) return 'runtime';
  if (eventType.startsWith('workspace.')) return 'workspace';
  if (eventType.startsWith('sync.') || eventType.startsWith('run.sync.')) {
    return 'sync';
  }
  if (eventType.startsWith('memory.')) return 'memory';
  if (
    eventType.startsWith('run.') ||
    eventType.startsWith('attempt.') ||
    eventType.startsWith('run.attempt_')
  ) {
    return 'lifecycle';
  }
  return 'other';
}
