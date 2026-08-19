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

import { DetailedTimeline } from './DetailedTimeline';
import { NormalTimeline, type TimelineModeProps } from './NormalTimeline';
import { SummarizedTimeline } from './SummarizedTimeline';

export interface TimelineModeRendererProps extends TimelineModeProps {
  detailLevel: ChatTimelineDetailLevel;
}

export function TimelineModeRenderer({
  detailLevel,
  ...props
}: TimelineModeRendererProps) {
  if (detailLevel === 'detailed') return <DetailedTimeline {...props} />;
  if (detailLevel === 'summarized') return <SummarizedTimeline {...props} />;
  return <NormalTimeline {...props} />;
}

export { DetailedTimeline } from './DetailedTimeline';
export { NormalTimeline } from './NormalTimeline';
export { SummarizedTimeline } from './SummarizedTimeline';
