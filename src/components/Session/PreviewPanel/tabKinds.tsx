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

import type { PreviewTabKind, SessionPreviewTab } from '@/store/pageTabStore';
import {
  FileDiff,
  FileText,
  Globe,
  type LucideIcon,
  PanelsTopLeft,
  Shapes,
  SquareTerminal,
} from 'lucide-react';

export interface PreviewKindMeta {
  kind: PreviewTabKind;
  icon: LucideIcon;
  /** i18n key + fallback used for the tab title and chooser row label. */
  labelKey: string;
  defaultLabel: string;
  /** One-line description shown in the chooser. */
  descriptionKey: string;
  defaultDescription: string;
}

/**
 * The content kinds the chooser offers, in display order. Single source of
 * truth for icon + copy so the tab strip and chooser never drift.
 *
 * `canvas` is a reserved tab type (its component and store plumbing exist, and
 * persisted tabs still render) but is hidden from the chooser until a later
 * version ships its content. Re-add its entry here when that lands.
 */
export const PREVIEW_TAB_KINDS: PreviewKindMeta[] = [
  {
    kind: 'browser',
    icon: Globe,
    labelKey: 'layout.preview-kind-browser',
    defaultLabel: 'Browser',
    descriptionKey: 'layout.preview-kind-browser-desc',
    defaultDescription: 'Open and navigate web pages in an embedded browser.',
  },
  {
    kind: 'file',
    icon: FileText,
    labelKey: 'layout.preview-kind-file',
    defaultLabel: 'Files',
    descriptionKey: 'layout.preview-kind-file-desc',
    defaultDescription: 'Preview files produced or referenced in this session.',
  },
  {
    kind: 'review',
    icon: FileDiff,
    labelKey: 'layout.preview-kind-review',
    defaultLabel: 'Review',
    descriptionKey: 'layout.preview-kind-review-desc',
    defaultDescription: 'Inspect file changes made in this session.',
  },
  {
    kind: 'terminal',
    icon: SquareTerminal,
    labelKey: 'layout.preview-kind-terminal',
    defaultLabel: 'Terminal',
    descriptionKey: 'layout.preview-kind-terminal-desc',
    defaultDescription:
      'Open a local terminal that starts in this session’s folder.',
  },
];

const KIND_ICONS: Record<SessionPreviewTab['type'], LucideIcon> = {
  chooser: PanelsTopLeft,
  browser: Globe,
  file: FileText,
  review: FileDiff,
  terminal: SquareTerminal,
  canvas: Shapes,
};

/** Icon for any tab (including the chooser) — used by the tab strip. */
export function previewTabIcon(type: SessionPreviewTab['type']): LucideIcon {
  return KIND_ICONS[type];
}
