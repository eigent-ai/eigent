import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { useEffect, useState } from "react";
import UpdateElectron from "@/components/update";
import SideBar from "@/components/SideBar";
import Tasks from "./Project/Tasks";
import Triggers from "./Project/Triggers";
import Folder from "@/components/Folder";
import { useSidebarStore } from "@/store/sidebarStore";

export default function Home() {
	const { toggle } = useSidebarStore();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}

	const [activeTab, setActiveTab] = useState("tasks");

	useEffect(() => {
		if (!chatStore.activeTaskId) {
			projectStore.createProject("new project");
		}
	}, []);

	const renderContent = () => {
		switch (activeTab) {
			case "tasks":
				return <Tasks />;
			case "trigger":
				return <Triggers />;
			case "inbox":
				return (
					<div className="w-full h-full flex items-center justify-center bg-surface-secondary border-solid border-border-tertiary rounded-2xl overflow-hidden">
						<Folder />
					</div>
				);
			default:
				return <Tasks />;
		}
	};

	return (
		<div className="h-full min-h-0 flex flex-row overflow-hidden pt-10 px-2 pb-2">
			<SideBar activeTab={activeTab} onTabChange={setActiveTab} />
			<div className="flex-1 min-w-0 min-h-0 flex items-center justify-center gap-2 relative overflow-hidden">
				{renderContent()}
			</div>
			<UpdateElectron />
		</div>
	);
}
