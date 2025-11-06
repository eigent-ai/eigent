import { WorkSpaceMenu } from "@/components/WorkSpaceMenu";
import { Button } from "../ui/button";
import { CirclePlayIcon, MessageSquareText, MessageSquareX, PlayIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

type BottomBarProps = {
	onToggleChat?: () => void;
	isChatVisible?: boolean;
	tokens?: number;
	taskStatus?: "running" | "finished" | "pending" | "pause";
	onReplay?: () => void;
	replayDisabled?: boolean;
	replayLoading?: boolean;
};

function BottomBar({
	onToggleChat,
	isChatVisible = true,
	tokens = 0,
	taskStatus,
	onReplay,
	replayDisabled = false,
	replayLoading = false,
}: BottomBarProps) {
	const { t } = useTranslation();

	return (
		<div className="flex h-fit py-2 items-center justify-center z-50 relative">
			<div className="absolute left-0 flex items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					type="button"
					onClick={onToggleChat}
					aria-pressed={isChatVisible}
					aria-label={isChatVisible ? "Hide chat" : "Show chat"}
				>
					{isChatVisible ? (
						<MessageSquareX className="!h-[20px] !w-[20px]" />
					) : (
						<MessageSquareText className="!h-[20px] !w-[20px]" />
					)}
				</Button>
				<div className="text-text-information text-xs font-semibold leading-17">
					# {t("chat.token")} {tokens || 0}
				</div>
			</div>
			<WorkSpaceMenu />
			<div className="absolute right-0 flex items-center gap-xs">
				<Button
					variant="ghost"
					size="sm"
					onClick={onReplay}
					disabled={taskStatus !== "finished" || replayDisabled || replayLoading}
				>
					<CirclePlayIcon className="!h-[20px] !w-[20px]" />
					{t("chat.replay")}
				</Button>
			</div>
		</div>
	);
}

export default BottomBar;
