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

import { getChoosableSpaces } from '@/components/Layout/AppRail/pinnedSpaces';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { WorkspaceTab } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';
import NewSpaceDialog from './NewSpaceDialog';

/** Menu value for New Space; Space ids never take this form. */
export const NEW_SPACE_CHIP_VALUE = '__new-space__';

/**
 * "in Research ▾" in Home's New session composer: the Space the Session will
 * start in, which also sets its folder and file previews. It starts on the
 * active Space, the one worked in last.
 */
export function NewSessionSpaceChip() {
  const { t } = useTranslation();
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const { switchToSpace, switchingSpaceId } = useSpaceSwitch();
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } =
    useNewSpaceCreation('home_hub');

  const choosableSpaces = useMemo(
    () => getChoosableSpaces(spaces, projectsBySpaceId, activeSpaceId),
    [activeSpaceId, projectsBySpaceId, spaces]
  );
  const activeSpace = activeSpaceId ? spaces[activeSpaceId] : undefined;
  const chipLabel = activeSpace
    ? t('layout.new-session-in-space', {
        name: getActiveSpaceTriggerLabel(activeSpace.name, t),
      })
    : t('layout.spaces-select-space');

  const chooseSpace = (value: string) => {
    if (value === NEW_SPACE_CHIP_VALUE) {
      setNewSpaceDialogOpen(true);
      return;
    }
    if (value === activeSpaceId) return;
    void switchToSpace(value, { project: null, tab: WorkspaceTab.NewProject });
  };

  return (
    <>
      <Select
        value={activeSpace ? activeSpace.id : ''}
        onValueChange={chooseSpace}
        disabled={switchingSpaceId !== null}
      >
        <SelectTrigger
          size="xs"
          variant="secondary"
          aria-label={t('layout.new-session-space')}
          data-new-session-space-chip
          className="max-w-56 min-w-0"
          wrapperClassName="min-w-0 shrink"
        >
          <SelectValue>{chipLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent fitTrigger={false}>
          <SelectGroup>
            <SelectLabel>{t('layout.new-session-start-in')}</SelectLabel>
            {choosableSpaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {getActiveSpaceTriggerLabel(space.name, t)}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={NEW_SPACE_CHIP_VALUE}>
            {t('layout.new-space')}
          </SelectItem>
        </SelectContent>
      </Select>
      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={createBlankSpace}
        onUseLocalFolder={createSpaceFromFolder}
      />
    </>
  );
}
