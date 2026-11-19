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

export type SidebarPanelConstraints = {
  min: number;
  max: number;
  rail: number;
};

/**
 * Return a valid two-panel default layout for react-resizable-panels.
 *
 * The sidebar constraints are derived from fixed pixel widths and therefore
 * change with the window width. A static 24/76 default becomes invalid on
 * wide or narrow windows, so clamp the expanded default to the current
 * constraints and derive the complementary main-panel size.
 */
export function workspacePanelDefaultLayout(
  constraints: SidebarPanelConstraints,
  folded: boolean,
  preferredSidebarSize = 24
): readonly [number, number] {
  const sidebar = folded
    ? constraints.rail
    : Math.min(
        constraints.max,
        Math.max(constraints.min, preferredSidebarSize)
      );
  return [sidebar, 100 - sidebar] as const;
}
