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

import { DsIcon, type DsIconRecipe } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { SPACE_ICONS } from '@/lib/spaceIcons';

/** The letter a Space shows until it has an icon of its own. */
export function spaceInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/**
 * What a Space tile shows: its chosen icon, or the first letter of its name.
 * The tile itself belongs to each surface.
 */
export function SpaceGlyph({
  name,
  iconId,
  recipe = 'main',
}: {
  name: string;
  iconId: string | null;
  recipe?: Exclude<DsIconRecipe, 'illustration'>;
}) {
  const Icon = iconId ? SPACE_ICONS[iconId] : undefined;
  if (Icon) return <DsIcon icon={Icon} recipe={recipe} aria-hidden />;
  return (
    <DsText as="span" role="meta" weight="semibold">
      {spaceInitial(name)}
    </DsText>
  );
}
