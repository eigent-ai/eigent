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
import { persist } from 'zustand/middleware';

// Define state types
interface GlobalStore {
	history_type: "grid" | "list" | "table";
	setHistoryType: (history_type: "grid" | "list" | "table") => void;
	toggleHistoryType: () => void;
}

// Create store
const globalStore = create<GlobalStore>()(
	persist(
		(set) => ({
			history_type: "list",
			setHistoryType: (history_type: "grid" | "list" | "table") =>
				set({ history_type }),
			toggleHistoryType: () =>
				set((state) => {
					// Cycle through: grid -> list -> table -> grid
					if (state.history_type === "grid") return { history_type: "list" };
					if (state.history_type === "list") return { history_type: "table" };
					return { history_type: "grid" };
				}),
		}),
		{
			name: 'global-storage',
		}
	)
);

// Export Hook version for components
export const useGlobalStore = globalStore;

// Export non-Hook version for non-components
export const getGlobalStore = () => globalStore.getState();