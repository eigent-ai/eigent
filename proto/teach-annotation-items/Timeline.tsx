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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { ChevronDown, ChevronUp, SquareDashedMousePointer } from 'lucide-react';
import type { VariantProps } from './data';

/** A compact chronological scan with an anchored context rail. */
export default function Timeline({
  items,
  expanded,
  onToggle,
  onViewSource,
}: VariantProps) {
  return (
    <ol className="timeline-list">
      {items.map((item, index) => {
        const open = expanded.has(item.id);
        return (
          <li key={item.id} className="timeline-row">
            <span className="timeline-rail" aria-hidden="true">
              <span className="timeline-node">
                <DsIcon icon={SquareDashedMousePointer} recipe="main" />
              </span>
            </span>
            <article className="timeline-body">
              <div className="timeline-head">
                <span className="timeline-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="item-identity">
                  <strong title={item.context}>{item.context}</strong>
                  <span>{item.detail}</span>
                </div>
                <time>{item.time}</time>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={open ? 'Fold annotation' : 'Expand annotation'}
                  aria-expanded={open}
                  onClick={() => onToggle(item.id)}
                >
                  <DsIcon icon={open ? ChevronUp : ChevronDown} recipe="main" />
                </Button>
              </div>
              {open ? (
                <div className="timeline-expanded">
                  <p>{item.comment}</p>
                  <blockquote>{item.quote}</blockquote>
                  <Button
                    type="button"
                    variant="text"
                    size="xs"
                    onClick={() => onViewSource(item)}
                  >
                    View work
                  </Button>
                </div>
              ) : (
                <p className="item-preview">{item.comment}</p>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
