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

import { DsIcon } from '@/components/ui/ds-icon';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { AnnotationMarkdown } from './AnnotationMarkdown';
import {
  AnnotationHeader,
  CommentInput,
  FormFooter,
  handleSubmit,
  type VariantProps,
} from './shared';

export default function Expandable(props: VariantProps) {
  const [showExcerpt, setShowExcerpt] = useState(false);
  return (
    <form
      className="proto-card proto-expandable"
      onSubmit={(event) => handleSubmit(event, props.onSave)}
    >
      <AnnotationHeader />
      <div className="proto-excerpt-section">
        <button
          type="button"
          className="proto-excerpt-toggle"
          aria-expanded={showExcerpt}
          aria-controls="proto-excerpt-content"
          onClick={() => setShowExcerpt((open) => !open)}
        >
          <span>Selected output</span>
          <DsIcon
            icon={ChevronDown}
            recipe="main"
            className={showExcerpt ? 'proto-chevron-open' : ''}
          />
        </button>
        <div
          id="proto-excerpt-content"
          className="proto-excerpt-quote proto-quote"
          hidden={!showExcerpt}
        >
          <AnnotationMarkdown />
        </div>
      </div>
      <CommentInput id="proto-excerpt-comment" {...props} />
      <FormFooter value={props.value} />
    </form>
  );
}
