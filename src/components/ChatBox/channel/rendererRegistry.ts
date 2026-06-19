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

import type { ChannelItemKind } from '@/types/sessionChannel';
import type { ChannelRenderer } from './context';
import { AskRenderer } from './renderers/AskRenderer';
import {
  AgentMessageRenderer,
  ChainOfThoughtRenderer,
  ErrorRenderer,
  FileOutputRenderer,
  SkipMarkerRenderer,
  UserMessageRenderer,
} from './renderers/messageRenderers';
import {
  PlanRenderer,
  PreparingRenderer,
  TurnBoundaryRenderer,
  WorkLogRenderer,
} from './renderers/structureRenderers';

/**
 * Maps each `ChannelItemKind` to its renderer. The view is a flat map that
 * looks up a renderer by `item.kind` — adding a kind means adding one entry
 * here, not touching a giant switch.
 */
export const rendererRegistry: Record<
  ChannelItemKind,
  ChannelRenderer<never>
> = {
  'turn-boundary': TurnBoundaryRenderer as ChannelRenderer<never>,
  'user-message': UserMessageRenderer as ChannelRenderer<never>,
  'agent-message': AgentMessageRenderer as ChannelRenderer<never>,
  plan: PlanRenderer as ChannelRenderer<never>,
  'work-log': WorkLogRenderer as ChannelRenderer<never>,
  preparing: PreparingRenderer as ChannelRenderer<never>,
  'chain-of-thought': ChainOfThoughtRenderer as ChannelRenderer<never>,
  error: ErrorRenderer as ChannelRenderer<never>,
  failed: ErrorRenderer as ChannelRenderer<never>,
  'file-output': FileOutputRenderer as ChannelRenderer<never>,
  ask: AskRenderer as ChannelRenderer<never>,
  'skip-marker': SkipMarkerRenderer as ChannelRenderer<never>,
};
