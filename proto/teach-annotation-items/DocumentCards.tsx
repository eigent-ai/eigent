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

/** A document-like card: the student's work and the teacher's note are separated. */
export default function DocumentCards({
  items,
  expanded,
  onToggle,
  onViewSource,
}: VariantProps) {
  return (
    <div className="document-list">
      {items.map((item) => {
        const open = expanded.has(item.id);
        return (
          <article key={item.id} className="document-card">
            <div className="document-head">
              <span className="document-file-icon">
                <DsIcon icon={SquareDashedMousePointer} recipe="main" />
              </span>
              <div className="item-identity">
                <strong title={item.context}>{item.context}</strong>
                <span>
                  {item.detail} · {item.time}
                </span>
              </div>
              <Button
                type="button"
                variant="text"
                size="sm"
                onClick={() => onViewSource(item)}
              >
                View work
              </Button>
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
              <div className="document-content">
                <div className="document-quote">
                  <span>Selected work</span>
                  <blockquote>{item.quote}</blockquote>
                </div>
                <div className="document-comment">
                  <span>Your comment</span>
                  <p>{item.comment}</p>
                </div>
              </div>
            ) : (
              <p className="document-preview">{item.comment}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
