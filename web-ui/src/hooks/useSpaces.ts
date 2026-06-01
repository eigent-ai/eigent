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

import type { WebSpace } from '@web/types';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'eigent-dispatch-active-space';

const DEFAULT_SPACES: WebSpace[] = [
  { id: 'personal', name: 'Personal', folderPath: '~/Eigent/Spaces/Personal' },
  { id: 'work', name: 'Work', folderPath: '~/Eigent/Spaces/Work' },
];

function readStoredSpaceId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SPACES[0].id;
  } catch {
    return DEFAULT_SPACES[0].id;
  }
}

export function useSpaces() {
  const [activeSpaceId, setActiveSpaceIdState] = useState(readStoredSpaceId);

  const activeSpace =
    DEFAULT_SPACES.find((space) => space.id === activeSpaceId) ??
    DEFAULT_SPACES[0];

  const setActiveSpace = useCallback((spaceId: string) => {
    setActiveSpaceIdState(spaceId);
    try {
      localStorage.setItem(STORAGE_KEY, spaceId);
    } catch {
      // ignore storage failures
    }
  }, []);

  return {
    spaces: DEFAULT_SPACES,
    activeSpace,
    activeSpaceId: activeSpace.id,
    setActiveSpace,
  };
}
