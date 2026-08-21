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

import { MarkDown as SharedMarkDown } from '@/components/ChatBox/MessageItem/MarkDown';

/**
 * Compact compatibility wrapper for tool calls, trajectories, and workflow
 * details. Keeping one renderer means code blocks, tables, sanitization, and
 * theme behavior no longer drift between chat and diagnostic surfaces.
 */
export const MarkDown = ({
  content,
  speed = 15,
  onTyping,
  enableTypewriter = true,
}: {
  content: string;
  speed?: number;
  onTyping?: () => void;
  enableTypewriter?: boolean;
  /** @deprecated The compact profile now owns its typography. */
  pTextSize?: string;
  /** @deprecated The compact profile now owns its list spacing. */
  olPadding?: string;
}) => (
  <SharedMarkDown
    content={content}
    speed={speed}
    onTyping={onTyping}
    enableTypewriter={enableTypewriter}
    profile="compact"
  />
);
