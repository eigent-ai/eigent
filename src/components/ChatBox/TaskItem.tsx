import { Textarea } from "@/components/ui/textarea";
import {
	Check,
	Circle,
	CircleDashed,
	CircleMinus,
	PenLine,
	Trash2,
	X,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "../ui/button";
import { useTranslation } from "react-i18next";

interface TaskItemProps {
	taskInfo: {
		id: string;
		content: string;
	};
	taskIndex: number;
	onUpdate: (content: string) => void;
	onDelete: () => void;
}

export function TaskItem({
	taskInfo,
	taskIndex,
	onUpdate,
	onDelete,
}: TaskItemProps) {
	const { t } = useTranslation();
	const [isFocus, setIsFocus] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const handleFocus = (e: React.MouseEvent<any>, isFocus: boolean) => {
		e.stopPropagation();
		if (isFocus) {
			setIsFocus(true);
			textareaRef.current?.focus();
		} else {
			setIsFocus(false);
			textareaRef.current?.blur();
		}
	};

	// auto adjust height
	const adjustHeight = () => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
		}
	};

	// when content changes, adjust height
	useEffect(() => {
		adjustHeight();
	}, [taskInfo.content]);

	return (
		<div key={`task-item-${taskIndex}`}>
			<div
				onDoubleClick={(e) => handleFocus(e, true)}
				className={`relative min-h-2 flex items-start p-sm group border border-transparent border-solid hover:bg-task-fill-hover rounded-lg ${
					isFocus ? "bg-task-fill-default border-task-border-focus-default" : ""
				}`}
			>
				<div className="w-7 h-4 pt-1 pr-sm flex items-center justify-center cursor-pointer flex-shrink-0">
					{taskInfo.id === "" ? (
						<CircleDashed size={13} className="text-icon-secondary" />
					) : (
						<div className="h-2 w-2 rounded-full bg-icon-information"></div>
					)}
				</div>
				<div
					className={`relative min-h-4 pb-2 w-full border-[0px] border-b border-solid transition-all
						 duration-300 border-task-border-default
						group-hover:border-transparent flex items-start`}
				>
					<Textarea
						ref={textareaRef}
						placeholder={t("layout.add-new-task")}
						className={`${
							isFocus && "w-[calc(100%-52px)]"
						} rounded-none p-0 bg-transparent text-xs leading-[20px] min-h-2 border-none shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none overflow-hidden`}
						value={taskInfo.content}
						onChange={(e) => onUpdate(e.target.value)}
						onBlur={() => {
							setTimeout(() => {
								setIsFocus(false);
							}, 100);
						}}
						rows={1}
					/>
					{!isFocus && (
						<div className="absolute inset-0 h-full w-full bg-transparent"></div>
					)}
				</div>
				<div
					className={`absolute right-2 top-2 flex items-center gap-xs group-hover:opacity-100 ${
						isFocus ? "opacity-100" : "opacity-0"
					} transition-opacity duration-300`}
				>
					{!isFocus ? (
						<Button
							onClick={(e) => handleFocus(e, true)}
							className="rounded-full"
							variant="outline"
							size="icon"
						>
							<PenLine
								size={16}
								className=""
							/>
						</Button>
					) : (
						<Button
							onClick={(e) => handleFocus(e, false)}
							className="rounded-full"
							variant="success"
							size="icon"
						>
							<Check
								size={16}
								className="text-button-fill-success-foreground"
							/>
						</Button>
					)}
					<Button
						onClick={() => onDelete()}
						className="rounded-full"
						variant="cuation"
						size="icon"
					>
						<Trash2 size={16} className="text-icon-tertiary" />
					</Button>
				</div>
			</div>
		</div>
	);
}
