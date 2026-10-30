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

import { useSpaceStore } from '@/store/spaceStore';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useSpaceLabel(spaceId?: string | null) {
  const { t } = useTranslation();
  const spacesById = useSpaceStore((state) => state.spaces);

  return useMemo(() => {
    if (!spaceId) {
      return t('layout.spaces-untitled');
    }
    const space = spacesById[spaceId];
    return space?.name?.trim() || t('layout.spaces-untitled');
  }, [spaceId, spacesById, t]);
}
