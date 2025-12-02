import { WorkSpaceMenu } from "@/components/WorkSpaceMenu";

interface BottomBarProps {
	onToggleChatBox?: () => void;
	isChatBoxVisible?: boolean;
}

function BottomBar({ onToggleChatBox, isChatBoxVisible }: BottomBarProps) {
	return (
		<div className="flex h-12 items-center justify-center z-50 relative">
			<WorkSpaceMenu onToggleChatBox={onToggleChatBox} isChatBoxVisible={isChatBoxVisible} />
		</div>
	);
}

export default BottomBar;
