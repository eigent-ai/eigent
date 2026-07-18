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
  ClipboardCheck,
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
 * `review`, `terminal`, and `canvas` are reserved tab types (their components
 * and store plumbing exist, and persisted tabs still render) but are hidden
 * from the chooser until a later version ships their content. Re-add their
 * entries here when that lands.
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
];

const KIND_ICONS: Record<SessionPreviewTab['type'], LucideIcon> = {
  chooser: PanelsTopLeft,
  browser: Globe,
  file: FileText,
  review: ClipboardCheck,
  terminal: SquareTerminal,
  canvas: Shapes,
};

/** Icon for any tab (including the chooser) — used by the tab strip. */
export function previewTabIcon(type: SessionPreviewTab['type']): LucideIcon {
  return KIND_ICONS[type];
}
