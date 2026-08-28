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

import { MarkDown } from './MarkDown';

/** Legacy import kept for compatibility; summaries now use the same GitHub-
 * style renderer as every other assistant response. */
export const SummaryMarkDown = ({
  content,
  speed = 15,
  onTyping,
  enableTypewriter = true,
}: {
  content: string;
  speed?: number;
  onTyping?: () => void;
  enableTypewriter?: boolean;
}) => (
  <MarkDown
    content={content}
    speed={speed}
    onTyping={onTyping}
    enableTypewriter={enableTypewriter}
    profile="conversation"
  />
);
