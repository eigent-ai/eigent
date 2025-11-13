import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Define state types
interface GlobalStore {
	history_type: "table" | "list" | "grouped";
	setHistoryType: (history_type: "table" | "list" | "grouped") => void;
	toggleHistoryType: () => void;
}

// Create store
const globalStore = create<GlobalStore>()(
	persist(
		(set) => ({
			history_type: "grouped",
			setHistoryType: (history_type: "table" | "list" | "grouped") =>
				set({ history_type }),
			toggleHistoryType: () =>
				set((state) => {
					// Cycle through: grouped -> list -> table -> grouped
					if (state.history_type === "grouped") return { history_type: "list" };
					if (state.history_type === "list") return { history_type: "table" };
					return { history_type: "grouped" };
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