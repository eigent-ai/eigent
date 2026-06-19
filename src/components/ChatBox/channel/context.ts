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

import type { VanillaChatStore } from '@/store/chatStore';
import type { ChannelItem } from '@/types/sessionChannel';
import type { FC } from 'react';

/** A turn's live chatStore handle (shadow-period bridge for interactive cards). */
export interface ResolvedTurn {
  chatStore: VanillaChatStore;
  taskId: string;
}

/**
 * Shared context passed to every channel renderer. During Stage 2 the heavy
 * interactive cards (TaskCard / PlanTaskBox / TaskWorkLogAccordion) still bind
 * to the live chatStore, resolved here by `turnId` (== taskId in shadow mode).
 */
export interface ChannelRenderContext {
  projectId: string;
  /** Resolve a turn's live chatStore handle, or null if it no longer exists. */
  resolveTurn: (turnId: string) => ResolvedTurn | null;
  /** Open a file in the workspace inbox (mirrors UserQueryGroup.openFilePreview). */
  openFilePreview: (turnId: string, file: FileInfo) => void;
}

export interface ChannelRendererProps<T extends ChannelItem = ChannelItem> {
  item: T;
  ctx: ChannelRenderContext;
}

export type ChannelRenderer<T extends ChannelItem = ChannelItem> = FC<
  ChannelRendererProps<T>
>;
