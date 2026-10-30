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

import type { ChatTimelineDetailLevel } from '@/types/chatTimeline';
import type { SessionModeType } from '@/types/constants';

import { NarrativeTimeline } from './NarrativeTimeline';
import type { TimelineModeProps } from './shared';
import { TrajectoryTimeline } from './TrajectoryTimeline';

export interface TimelineModeRendererProps extends TimelineModeProps {
  detailLevel: ChatTimelineDetailLevel;
  sessionMode?: SessionModeType;
}

/**
 * Only the work band differs between modes. The user query, plan, interrupts,
 * artifacts, and final response are rendered identically by both renderers so
 * toggling never moves the row the reader was looking at.
 */
export function TimelineModeRenderer({
  detailLevel,
  sessionMode,
  ...props
}: TimelineModeRendererProps) {
  if (detailLevel === 'trajectory') return <TrajectoryTimeline {...props} />;
  return <NarrativeTimeline sessionMode={sessionMode} {...props} />;
}

export { CallRow } from './CallRow';
export { NarrativeTimeline } from './NarrativeTimeline';
export { TrajectoryTimeline } from './TrajectoryTimeline';
