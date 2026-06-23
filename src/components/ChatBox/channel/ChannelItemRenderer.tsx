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

import type { ChannelItem, UnsupportedItem } from '@/types/sessionChannel';
import React from 'react';
import type { ChannelRenderContext } from './context';
import { rendererRegistry } from './rendererRegistry';
import { UnsupportedRenderer } from './renderers/structureRenderers';

/**
 * Per-item error boundary: if a renderer throws on a stale legacy data shape, we
 * degrade that single item to the hidden+inspectable `unsupported` fallback
 * instead of taking down the whole turn/channel. Scoped to one item so a bad
 * item never hides its siblings.
 */
class ItemErrorBoundary extends React.Component<
  { item: ChannelItem; ctx: ChannelRenderContext; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(
      `[session-channel] renderer threw for item ${this.props.item.id} (kind=${this.props.item.kind})`,
      error
    );
  }

  render() {
    if (this.state.failed) {
      const { item, ctx } = this.props;
      const fallback: UnsupportedItem = {
        id: `unsup-render-${item.id}`,
        kind: 'unsupported',
        turnId: item.turnId,
        seq: item.seq,
        createdAt: item.createdAt,
        reason: 'render-error',
        sourceStep: item.kind,
        messageId: item.id,
      };
      return <UnsupportedRenderer item={fallback} ctx={ctx} />;
    }
    return this.props.children;
  }
}

/** Looks up `registry[item.kind]` and renders it, or nothing for an unknown kind. */
export const ChannelItemRenderer: React.FC<{
  item: ChannelItem;
  ctx: ChannelRenderContext;
}> = ({ item, ctx }) => {
  const Renderer = rendererRegistry[item.kind];
  if (!Renderer) return null;
  return (
    <ItemErrorBoundary item={item} ctx={ctx}>
      <Renderer item={item as never} ctx={ctx} />
    </ItemErrorBoundary>
  );
};
