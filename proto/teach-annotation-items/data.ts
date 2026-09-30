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

export type Annotation = {
  id: string;
  sessionId: 'london' | 'audit';
  context: string;
  detail: string;
  quote: string;
  comment: string;
  time: string;
};

const examples: Omit<Annotation, 'id' | 'sessionId' | 'time'>[] = [
  {
    context: 'Final answer',
    detail: 'Whole run',
    quote:
      'I have created the poem in both Markdown and PDF formats in your workspace: Markdown: london_poem.md PDF: london_poem.pdf',
    comment:
      'The answer should lead with the finished poem, then list the files. Please keep the wording simple enough for a reader who has never worked with Markdown.',
  },
  {
    context: 'london_poem.md',
    detail: 'File · line 18',
    quote: 'A heartbeat older than the time.',
    comment:
      'This final line feels vague beside the concrete images above it. Keep the rhythm, but make the image more specific.',
  },
  {
    context: 'Verify the Markdown and PDF files',
    detail: 'Agent log · 2:41 PM',
    quote:
      'Opened both files and confirmed they exist in the workspace. The PDF preview did not render in the browser tool.',
    comment:
      'The agent should say that the PDF preview failed rather than claiming it verified the PDF content. File existence alone is not enough.',
  },
  {
    context:
      '2026-09-30_London_Poem_Final_Revision_With_Notes_For_Editorial_Review.pdf',
    detail: 'Artifact · PDF',
    quote:
      'Grey mist upon the winding Thames, where stone and shadow softly meet…',
    comment:
      'The long filename is hard to scan. Please use “London poem.pdf” for the final deliverable and keep revision detail in the work log.',
  },
  {
    context: 'Browser preview',
    detail: 'Browser · eigent.ai',
    quote: 'The local preview opens at the top of the page.',
    comment:
      'The first screen looks good. Please check the narrow-window layout too; the right column overlaps the poem at around 900px.',
  },
];

export const initialAnnotations: Annotation[] = Array.from(
  { length: 40 },
  (_, index) => {
    const example = examples[index % examples.length];
    return {
      ...example,
      id: `annotation-${index + 1}`,
      sessionId: index < 24 ? 'london' : 'audit',
      time: index < 5 ? 'Today, 4:15 PM' : `Sep 29, ${3 + (index % 9)}:20 PM`,
    };
  }
);

export type VariantProps = {
  items: Annotation[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onViewSource: (item: Annotation) => void;
};
