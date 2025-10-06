import { useChatStore } from "@/store/chatStore";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useUser } from "@stackframe/react";
import { hasStackKeys } from "@/lib";
import { useAuthStore } from "@/store/authStore";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import Project from "@/pages/Dashboard/Project";
import Trigger from "@/pages/Dashboard/Trigger";
import AlertDialog from "@/components/ui/alertDialog";
import { Bot } from "@/components/animate-ui/icons/bot";
import { Settings } from "@/components/animate-ui/icons/settings";
import { Pin } from "@/components/animate-ui/icons/pin";
import { AlarmClock } from "@/components/animate-ui/icons/alarm-clock";
import Setting from "@/pages/Setting";
import { cn } from "@/lib/utils";
import { Hammer } from "@/components/animate-ui/icons/hammer";
import MCP from "./Setting/MCP";



export default function Home() {
	const {t} = useTranslation()
	const navigate = useNavigate();
	const chatStore = useChatStore();
	const [activeTab, setActiveTab] = useState<"projects" | "workers" | "trigger" | "settings" | "mcp_tools">("projects");
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const HAS_STACK_KEYS = hasStackKeys();
	const stackUser = HAS_STACK_KEYS ? useUser({ or: 'anonymous-if-exists' }) : null;
	const { username, email } = useAuthStore();
	const displayName = stackUser?.displayName ?? stackUser?.primaryEmail ?? username ?? email ?? "";

	const formatWelcomeName = (raw: string): string => {
		if (!raw) return "";
		if (/^[^@]+@gmail\.com$/i.test(raw)) {
			const local = raw.split("@")[0];
			const pretty = local.replace(/[._-]+/g, " ").trim();
			return pretty
				.split(/\s+/)
				.map(part => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
		}
		return raw;
	};

	const welcomeName = formatWelcomeName(displayName);

	const confirmDelete = () => {
		setDeleteModalOpen(false);
	};

	// create task
	const createChat = () => {
		const taskId = Object.keys(chatStore.tasks).find((taskId) => {
			console.log(chatStore.tasks[taskId].messages.length);
			return chatStore.tasks[taskId].messages.length === 0;
		});
		if (taskId) {
			chatStore.setActiveTaskId(taskId);
			navigate(`/`);
			return;
		}
		chatStore.create();
		navigate("/");
	};

  useEffect(() => {}, []);

	return (
		<div ref={scrollContainerRef} className="h-full overflow-y-auto scrollbar-hide mx-auto">
		{/* alert dialog */}
		<AlertDialog
			isOpen={deleteModalOpen}
			onClose={() => setDeleteModalOpen(false)}
			onConfirm={confirmDelete}
			title="Delete Task"
			message="Are you sure you want to delete this task? This action cannot be undone."
			confirmText="Delete"
			cancelText="Cancel"
		/>
		{/* welcome text */}
			<div className="flex flex-col w-full pt-12 pb-4 bg-bg-page">
				<div className="mx-auto w-full px-8">
					<span className="text-text-primary text-heading-lg !font-serif font-bold">Welcome {welcomeName}</span>
				</div>
			</div>
			{/* top bar */}
			<div className="sticky top-0 z-20 flex flex-col justify-between items-center bg-gradient-to-t from-surface-secondary to-bg-page backdrop-blur-xl pt-4">
				<div className="flex flex-row justify-between items-center pb-6 px-8 border-border-disabled border-x-0 border-t-0 border-solid w-full mx-auto">
				<MenuToggleGroup type="single" value={activeTab} orientation="horizontal" onValueChange={(v) => v && setActiveTab(v as typeof activeTab)}>
			  	<MenuToggleItem size="sm" value="projects" iconAnimateOnHover="wiggle" icon={<Pin/>}>Projects</MenuToggleItem>
					<MenuToggleItem size="sm" value="mcp_tools" iconAnimateOnHover="default" icon={<Hammer/>}>MCP & Tools</MenuToggleItem>
					<MenuToggleItem size="sm" value="settings" iconAnimateOnHover="default" icon={<Settings/>}>Settings</MenuToggleItem>
			  	<MenuToggleItem size="sm" value="workers" iconAnimateOnHover="default" icon={<Bot/>} disabled>Workers</MenuToggleItem>
			  	<MenuToggleItem size="sm" value="trigger" iconAnimateOnHover="default" icon={<AlarmClock/>} disabled>Triggers</MenuToggleItem>
		  	</MenuToggleGroup>
		  	<Button variant="primary" size="sm" onClick={createChat}>
				<Plus />
				{t("task-hub.new-project")}
		  	</Button>
			</div>
		  </div>
	      {activeTab === "projects" && <Project />}
	      {activeTab === "mcp_tools" && <MCP />}
	      {activeTab === "trigger" && <Trigger />}
				{activeTab === "settings" && <Setting />}
		</div>
	);
}
