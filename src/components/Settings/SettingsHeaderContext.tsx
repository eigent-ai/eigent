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

import type { SettingsSectionId } from '@/store/settingsStore';
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface SettingsHeaderOverride {
  title: ReactNode;
  onBack?: () => void;
  hideTitle?: boolean;
}

interface SettingsHeaderContextValue {
  activeSection: SettingsSectionId;
  headerOverride: SettingsHeaderOverride | null;
  setHeaderOverride: (value: SettingsHeaderOverride | null) => void;
  headerActionsElement: HTMLElement | null;
  setHeaderActionsElement: Dispatch<SetStateAction<HTMLElement | null>>;
}

const SettingsHeaderContext = createContext<SettingsHeaderContextValue | null>(
  null
);

interface SettingsHeaderProviderProps {
  activeSection: SettingsSectionId;
  children: ReactNode;
}

export function SettingsHeaderProvider({
  activeSection,
  children,
}: SettingsHeaderProviderProps) {
  const [renderedSection, setRenderedSection] = useState(activeSection);
  const [headerOverride, setHeaderOverrideState] =
    useState<SettingsHeaderOverride | null>(null);
  const [headerActionsElement, setHeaderActionsElement] =
    useState<HTMLElement | null>(null);

  if (renderedSection !== activeSection) {
    setRenderedSection(activeSection);
    setHeaderOverrideState(null);
  }

  const setHeaderOverride = useCallback(
    (value: SettingsHeaderOverride | null) => {
      setHeaderOverrideState(value);
    },
    []
  );

  const value = useMemo(
    () => ({
      activeSection,
      headerOverride,
      setHeaderOverride,
      headerActionsElement,
      setHeaderActionsElement,
    }),
    [activeSection, headerActionsElement, headerOverride, setHeaderOverride]
  );

  return (
    <SettingsHeaderContext.Provider value={value}>
      {children}
    </SettingsHeaderContext.Provider>
  );
}

export function useSettingsHeader() {
  const context = useContext(SettingsHeaderContext);
  if (!context) {
    throw new Error(
      'useSettingsHeader must be used inside SettingsHeaderProvider'
    );
  }
  return context;
}

export function SettingsHeaderActions({ children }: { children: ReactNode }) {
  const { activeSection, headerActionsElement } = useSettingsHeader();
  const [ownerSection] = useState(activeSection);
  return headerActionsElement && ownerSection === activeSection
    ? createPortal(children, headerActionsElement)
    : null;
}
