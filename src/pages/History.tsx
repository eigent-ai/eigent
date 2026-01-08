import { useEffect, useRef, useState } from "react";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/store/authStore";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import Project from "@/pages/Dashboard/Project";
import Trigger from "@/pages/Dashboard/Trigger";
import AlertDialog from "@/components/ui/alertDialog";
import { Settings } from "@/components/animate-ui/icons/settings";
import { Pin } from "@/components/animate-ui/icons/pin";
import { Compass } from "@/components/animate-ui/icons/compass";
import Setting from "@/pages/Setting";
import { cn } from "@/lib/utils";
import { Hammer } from "@/components/animate-ui/icons/hammer";
import MCP from "./Setting/MCP";
import Browser from "./Dashboard/Browser";
import WordCarousel from "@/components/ui/WordCarousel";
import { Sparkle } from "@/components/animate-ui/icons/sparkle";



export default function Home() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore || !projectStore) {
		return <div>Loading...</div>;
	}
  const tabParam = searchParams.get("tab") as "projects" | "workers" | "trigger" | "settings" | "mcp_tools" | "browser" | null;
  const [activeTab, setActiveTab] = useState<"projects" | "workers" | "trigger" | "settings" | "mcp_tools" | "browser">(tabParam || "projects");

	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { username, email } = useAuthStore();
	const displayName = username ?? email ?? "";

	// Sync activeTab with URL changes
	useEffect(() => {
		const tab = searchParams.get("tab") as "projects" | "workers" | "trigger" | "settings" | "mcp_tools" | null;
		if (tab) {
			setActiveTab(tab);
		}
	}, [searchParams]);

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

	const handleAnimationComplete = () => {
		console.log('All letters have animated!');
	};

	const confirmDelete = () => {
		setDeleteModalOpen(false);
	};

	// create task
	const createChat = () => {
		//Handles refocusing id & non duplicate logic internally
		projectStore.createProject("new project");
		navigate("/");
	};

  useEffect(() => {
		// Update active tab when URL parameter changes
		const tabFromUrl = searchParams.get('tab');
		const validTabs = ["projects", "workers", "trigger", "settings", "mcp_tools"];
		if (tabFromUrl && validTabs.includes(tabFromUrl)) {
			setActiveTab(tabFromUrl as typeof activeTab);
		}
	}, [searchParams]);

	return (
		<div ref={scrollContainerRef} className="h-full overflow-y-auto scrollbar-hide mx-auto">
		{/* alert dialog */}
		<AlertDialog
			isOpen={deleteModalOpen}
			onClose={() => setDeleteModalOpen(false)}
			onConfirm={confirmDelete}
			title={t("layout.delete-task")}
			message={t("layout.delete-task-confirmation")}
			confirmText={t("layout.delete")}
			cancelText={t("layout.cancel")}
		/>
			{/* welcome text */}
			<div className="flex flex-row w-full pt-16 px-20 bg-gradient-to-b from-transparent to-[#F9F8F6]">
					<WordCarousel
						words={[`${t("layout.welcome")}, ${welcomeName} !`]}
						className="text-heading-xl font-bold tracking-tight"
						rotateIntervalMs={100}
						sweepDurationMs={2000}
						sweepOnce
						gradient={`linear-gradient(in oklch 90deg,
							#f9f8f6 0%, var(--colors-blue-300) 30%,
							var(--colors-emerald-default) 50%, 
							var(--colors-green-500) 70%,
							var(--colors-orange-300) 100%)`}
						ariaLabel="rotating headline"
					/>
			</div>
			{/* Navbar */}
		<div
			className={`sticky top-0 z-20 flex flex-col justify-between items-center bg-[#F9F8F6] px-20 pt-10 pb-4 border-border-disabled border-x-0 border-t-0 border-solid`}
		>
				<div className="flex flex-row justify-between items-center w-full mx-auto">
				<div className="flex items-center gap-2">
			 	 <MenuToggleGroup type="single" value={activeTab} orientation="horizontal" onValueChange={(v) => v && setActiveTab(v as typeof activeTab)}>
			  	 <MenuToggleItem size="xs" value="projects" iconAnimateOnHover="wiggle" icon={<Sparkle/>}>{t("layout.projects")}</MenuToggleItem>
					 <MenuToggleItem size="xs" value="mcp_tools" iconAnimateOnHover="default" icon={<Hammer/>}>{t("layout.mcp-tools")}</MenuToggleItem>
					 <MenuToggleItem size="xs" value="browser" iconAnimateOnHover="default" icon={<Compass/>}>{t("layout.browser")}</MenuToggleItem>
					 <MenuToggleItem size="xs" value="settings" iconAnimateOnHover="default" icon={<Settings/>}>{t("layout.settings")}</MenuToggleItem>
		  	 </MenuToggleGroup>
				</div>
		  	<Button variant="primary" size="sm" onClick={createChat}>
				<Plus />
				{t("layout.new-project")}
		  	</Button>
			</div>
		  </div>
	      {activeTab === "projects" && <Project />}
	      {activeTab === "mcp_tools" && <MCP />}
	      {activeTab === "browser" && <Browser />}
				{activeTab === "settings" && <Setting />}
		</div>
	);
}
