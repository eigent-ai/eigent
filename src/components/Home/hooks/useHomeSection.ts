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

import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export const HOME_SECTIONS = ['spaces'] as const;

export type HomeSection = (typeof HOME_SECTIONS)[number];

export function isHomeSection(value: string | null): value is HomeSection {
  return value !== null && HOME_SECTIONS.includes(value as HomeSection);
}

/**
 * The URL is the source of truth for the active home section, so the sidebar
 * rail and the content pane stay in sync without mirrored state.
 */
export function useHomeSection(): {
  section: HomeSection;
  setSection: (section: string) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('section');
  const section: HomeSection = isHomeSection(sectionFromUrl)
    ? sectionFromUrl
    : 'spaces';

  const setSection = useCallback(
    (next: string) => {
      if (!isHomeSection(next)) return;
      navigate(`?section=${next}`, {
        replace: true,
        state: location.state,
      });
    },
    [location.state, navigate]
  );

  return { section, setSection };
}
