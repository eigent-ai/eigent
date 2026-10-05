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

import {
  isAutomationRoleId,
  type AutomationRoleId,
} from '@/components/Trigger/automationExampleData';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The role is stored on this device until the user profile API carries it.
type AutomationProfileState = {
  role: AutomationRoleId | null;
  /** Session-only: the profile pop-up stays closed until the app restarts. */
  nudgeDismissed: boolean;
  setRole: (role: AutomationRoleId) => void;
  dismissNudge: () => void;
};

export const useAutomationProfileStore = create<AutomationProfileState>()(
  persist(
    (set) => ({
      role: null,
      nudgeDismissed: false,
      setRole: (role) => set({ role }),
      dismissNudge: () => set({ nudgeDismissed: true }),
    }),
    {
      name: 'eigent-automation-profile',
      partialize: (state) => ({ role: state.role }),
      merge: (persisted, current) => {
        const role = (persisted as { role?: unknown } | undefined)?.role;
        return { ...current, role: isAutomationRoleId(role) ? role : null };
      },
    }
  )
);
