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

/**
 * Agent icons aligned with WorkSpaceMenu / BottomBar worker toggles
 * (Bot + sub-icon pattern → here a single icon per mention id).
 */

import { cn } from '@/lib/utils';
import { Bot, CodeXml, FileText, Globe, Image } from 'lucide-react';

const ICON_CLASS: Record<string, string> = {
  workforce: 'text-text-camel',
  browser: 'text-text-browser',
  dev: 'text-text-developer',
  doc: 'text-text-document',
  media: 'text-text-multimodal',
};

export function MentionAgentListIcon({
  agentId,
  className,
  size = 16,
}: {
  agentId: string;
  className?: string;
  /** Pixel size; matches WorkSpaceMenu agentMap icons at 16 */
  size?: number;
}) {
  const colorClass = ICON_CLASS[agentId] ?? 'text-text-body';
  const iconClass = cn('shrink-0', colorClass, className);

  switch (agentId) {
    case 'workforce':
      return <Bot size={size} className={iconClass} aria-hidden />;
    case 'browser':
      return <Globe size={size} className={iconClass} aria-hidden />;
    case 'dev':
      return <CodeXml size={size} className={iconClass} aria-hidden />;
    case 'doc':
      return <FileText size={size} className={iconClass} aria-hidden />;
    case 'media':
      return <Image size={size} className={iconClass} aria-hidden />;
    default:
      return <Bot size={size} className={iconClass} aria-hidden />;
  }
}
