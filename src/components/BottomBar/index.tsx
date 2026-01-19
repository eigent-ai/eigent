import { WorkSpaceMenu } from "@/components/WorkSpaceMenu";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import { Inbox } from "lucide-react";
import { TooltipSimple } from "@/components/ui/tooltip";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { useTranslation } from "react-i18next";

interface BottomBarProps {
	onToggleChatBox?: () => void;
	isChatBoxVisible?: boolean;
}

// Red dot notification indicator
const RedDotIcon = () => (
	<div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
);

function BottomBar({ onToggleChatBox, isChatBoxVisible }: BottomBarProps) {
	const { t } = useTranslation();
	const { chatStore } = useChatStoreAdapter();

	// Check if there are new files
	const nuwFileNum = chatStore?.activeTaskId
		? (chatStore.tasks[chatStore.activeTaskId]?.nuwFileNum || 0)
		: 0;
	const hasNewFiles = nuwFileNum > 0;

	// Handle inbox click and reset notification
	const handleInboxClick = () => {
		if (chatStore?.activeTaskId) {
			// Reset the new file counter when user views inbox
			chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
			// Set active workspace to inbox
			chatStore.setActiveWorkSpace(chatStore.activeTaskId, "inbox");
		}
	};

	const activeWorkspace = chatStore?.activeTaskId
		? chatStore.tasks[chatStore.activeTaskId]?.activeWorkSpace
		: null;

	return (
		<div className="flex h-12 items-center justify-center z-50 relative pt-2">
			<WorkSpaceMenu
				onToggleChatBox={onToggleChatBox}
				isChatBoxVisible={isChatBoxVisible}
			/>
		</div>
	);
}

export default BottomBar;
