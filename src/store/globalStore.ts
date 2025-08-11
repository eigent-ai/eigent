import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Define state types
interface GlobalStore {
	history_type: "table" | "list";
	setHistoryType: (history_type: "table" | "list") => void;
	toggleHistoryType: () => void;
}

// Create store
const globalStore = create<GlobalStore>()(
	persist(
		(set) => ({
			history_type: "list",
			setHistoryType: (history_type: "table" | "list") =>
				set({ history_type }),
			toggleHistoryType: () =>
				set((state) => ({
					history_type: state.history_type === "table" ? "list" : "table",
				})),
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