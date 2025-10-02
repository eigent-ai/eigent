import { useChatStore } from "@/store/chatStore";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
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



export default function Home() {
	const {t} = useTranslation()
	const navigate = useNavigate();
	const chatStore = useChatStore();
	const [activeTab, setActiveTab] = useState<"projects" | "workers" | "trigger" | "settings">("projects");
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isTopbarExpanded, setIsTopbarExpanded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);

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

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const currentTop = el.scrollTop;
      const lastTop = lastScrollTopRef.current;

      // Expand when scrolling down, contract when scrolling up (reversed)
      if (currentTop < lastTop) {
        setIsTopbarExpanded(false);
      } else if (currentTop > lastTop) {
        setIsTopbarExpanded(true);
      }

      lastScrollTopRef.current = currentTop;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll as EventListener);
  }, []);

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
			<div className="flex flex-col w-full pt-24 pb-4 bg-bg-page">
				<div className="max-w-[900px] mx-auto w-full px-6">
				<span className="text-text-primary text-heading-lg !font-serif font-bold">Workforce in Your Hands</span>
				</div>
			</div>
			{/* top bar */}
			<div className="sticky top-0 z-10 flex flex-col justify-between items-center bg-bg-page backdrop-blur-xl px-3 pt-4">
			 <div
				 className={cn(
					"flex flex-row justify-between items-center pb-6 px-6 border-border-disabled border-x-0 border-t-0 border-solid w-full mx-auto",
					isTopbarExpanded ? "max-w-full" : "max-w-[900px]"
				 )}
				 style={{ transition: "max-width 300ms ease" }}
			 >
				<MenuToggleGroup type="single" value={activeTab} orientation="horizontal" onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
			  	<MenuToggleItem size="sm" value="projects" iconAnimateOnHover="wiggle" icon={<Pin/>}>Projects</MenuToggleItem>
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
	      {activeTab === "trigger" && <Trigger />}
				{activeTab === "settings" && <Setting />}
		</div>
	);
}
