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
			history_type: "grid",
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