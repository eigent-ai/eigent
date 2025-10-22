import { CircleCheckBig, CircleSlash2, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export type TaskStateType =
	| "all"
	| "done"
	| "reassigned"
	| "ongoing"
	| "pending"
	| "failed";

export interface TaskStateProps {
	all?: number;
	done: number;
	progress: number;
	skipped: number;
	reAssignTo?: number;
	failed?: number;
	forceVisible?: boolean;
	selectedState?: TaskStateType;
	onStateChange?: (selectedState: TaskStateType) => void;
	clickable?: boolean;
}

export const TaskState = ({
	all,
	done,
	reAssignTo,
	progress,
	skipped,
	failed,
	forceVisible = false,
	selectedState = "all",
	onStateChange,
	clickable = true,
}: TaskStateProps) => {
	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const { t } = useTranslation();
	const handleStateClick = (state: TaskStateType) => {
		if (!clickable || !onStateChange) return;
		onStateChange(state || "all");
	};

	const isSelected = (state: TaskStateType) => {
		return selectedState === state;
	};

	const numberClass = `rounded-lg inline-block align-bottom transition-all duration-300 ease-in-out max-w-[40px] group-hover:max-w-[40px] group-hover:opacity-100`;

	return (
		<div>
			<div className="w-auto bg-transparent flex items-center gap-1 flex-wrap">
				{/* All */}
				{all && (forceVisible || all > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center py-0.5 px-2 transition-all duration-200 ${
							isSelected("all") ? "bg-tag-surface" : "bg-transparent"
						} ${clickable ? "cursor-pointer" : ""}`}
						onClick={() => handleStateClick("all")}
					>
						<span className="text-xs font-normal text-text-body">
							{t("chat.all")} <span className={numberClass}>{all}</span>
						</span>
					</div>
				) : null}

				{/* Done */}
				{done && (forceVisible || done > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center px-0.5 py-0.5 transition-all duration-200 ${
							isSelected("done") && "bg-tag-surface"
						} ${
							clickable && "cursor-pointer hover:opacity-80 transition-opacity"
						}`}
						onClick={() => handleStateClick("done")}
					>
						<CircleCheckBig
							className={`w-[10px] h-[10px] text-icon-secondary group-hover:text-icon-success ${
								(isSelected("done") || forceVisible) && "!text-icon-success"
							}`}
						/>
						<span
							className={`transition-all duration-200 text-xs leading-tight font-normal text-text-label group-hover:text-text-success ${
								(isSelected("done") || forceVisible) && "!text-text-success"
							}`}
						>
							{t("chat.done")} <span className={numberClass}>{done}</span>
						</span>
					</div>
				) : null}

				{/* Reassigned */}
				{reAssignTo && (forceVisible || reAssignTo > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center px-0.5 py-0.5 transition-all duration-200 ${
							isSelected("reassigned") && "bg-tag-surface"
						} ${
							clickable && "cursor-pointer hover:opacity-80 transition-opacity"
						}`}
						onClick={() => handleStateClick("reassigned")}
					>
						<CircleSlash2
							className={`w-[10px] h-[10px] text-icon-secondary group-hover:text-icon-warning ${
								(isSelected("reassigned") || forceVisible) &&
								"!text-icon-warning"
							}`}
						/>
						<span
							className={`transition-all duration-200 text-xs leading-tight font-normal text-text-label group-hover:text-text-warning ${
								(isSelected("reassigned") || forceVisible) &&
								"!text-text-warning"
							}`}
						>
							{t("chat.reassigned")}{" "}
							<span className={numberClass}>{reAssignTo}</span>
						</span>
					</div>
				) : null}

				{/* Ongoing */}
				{progress && (forceVisible || progress > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center px-0.5 py-0.5 ${
							isSelected("ongoing") && "bg-tag-surface"
						} ${
							clickable && "cursor-pointer hover:opacity-80 transition-opacity"
						}`}
						onClick={() => handleStateClick("ongoing")}
					>
						<LoaderCircle
							className={`w-[10px] h-[10px] text-icon-secondary group-hover:text-icon-information ${
								(isSelected("ongoing") || forceVisible) &&
								"!text-icon-information"
							} ${
								chatStore.tasks[chatStore.activeTaskId as string]?.status ===
									"running" && "animate-spin"
							}`}
						/>
						<span
							className={`transition-all duration-200 text-xs leading-tight font-normal text-text-label group-hover:text-text-information ${
								(isSelected("ongoing") || forceVisible) &&
								"!text-text-information"
							}`}
						>
							{t("chat.ongoing")}{" "}
							<span className={numberClass}>{progress}</span>
						</span>
					</div>
				) : null}

				{/* Failed */}
				{failed && (forceVisible || failed > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center px-0.5 py-0.5 transition-all duration-200 ${
							isSelected("failed") && "bg-tag-surface"
						} ${
							clickable && "cursor-pointer hover:opacity-80 transition-opacity"
						}`}
						onClick={() => handleStateClick("failed")}
					>
						<CircleSlash2
							className={`w-[10px] h-[10px] text-icon-secondary group-hover:text-icon-cuation ${
								(isSelected("failed") || forceVisible) && "!text-icon-cuation"
							}`}
						/>
						<span
							className={`transition-all duration-200 text-xs leading-tight font-normal text-text-label group-hover:!text-icon-cuation ${
								(isSelected("failed") || forceVisible) && "!text-text-cuation"
							}`}
						>
							{t("chat.failed")} <span className={numberClass}>{failed}</span>
						</span>
					</div>
				) : null}
				{/* Pending */}
				{skipped && (forceVisible || skipped > 0) ? (
					<div
						className={`group hover:bg-tag-surface flex gap-xs items-center px-0.5 py-0.5 ${
							isSelected("pending") ? "bg-tag-surface" : "bg-transparent"
						} ${
							clickable && "cursor-pointer hover:opacity-80 transition-opacity"
						}`}
						onClick={() => handleStateClick("pending")}
					>
						<LoaderCircle
							className={`w-[10px] h-[10px] text-icon-secondary group-hover:text-primary-foreground ${
								(isSelected("pending") || forceVisible) &&
								"text-primary-foreground"
							}`}
						/>
						<span
							className={`text-xs leading-tight font-normal text-text-label group-hover:text-primary-foreground ${
								(isSelected("pending") || forceVisible) &&
								"text-primary-foreground"
							}`}
						>
							{t("chat.pending")} <span className={numberClass}>{skipped}</span>
						</span>
					</div>
				) : null}
			</div>
		</div>
	);
};
