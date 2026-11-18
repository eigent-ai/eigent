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

import { create } from 'zustand';

/**
 * The Space switch in progress, shared because many surfaces can start one.
 * Only the latest move counts: `sequence` tells an older, slower switch to stop.
 */
export const useSpaceSwitchStore = create<{
  sequence: number;
  switchingSpaceId: string | null;
}>(() => ({ sequence: 0, switchingSpaceId: null }));

export function beginSpaceSwitch(spaceId: string | null): number {
  const sequence = useSpaceSwitchStore.getState().sequence + 1;
  useSpaceSwitchStore.setState({ sequence, switchingSpaceId: spaceId });
  return sequence;
}

/**
 * Stop a switch still on its way, because the person moved somewhere that
 * needs no switch of its own, such as a Session in the active Space.
 */
export function cancelPendingSpaceSwitch(): void {
  if (useSpaceSwitchStore.getState().switchingSpaceId !== null) {
    beginSpaceSwitch(null);
  }
}
