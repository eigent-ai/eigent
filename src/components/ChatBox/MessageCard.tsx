import { Copy, FileText } from "lucide-react";
import { MarkDown } from "./MarkDown";
import { useMemo } from "react";
import { Button } from "../ui/button";

interface MessageCardProps {
	id: string;
	content: string;
	role: "user" | "agent";
	className?: string;
	typewriter?: boolean;
	attaches?: File[];
	onTyping?: () => void;
}

// global Map to track completed typewriter effect content hash
const completedTypewriterHashes = new Map<string, boolean>();

export function MessageCard({
	id,
	content,
	role,
	typewriter = true,
	onTyping,
	className,
	attaches,
}: MessageCardProps) {
	// use content hash to track if typewriter effect is completed
	const contentHash = useMemo(() => {
		return `${id}-${content}`;
	}, [id, content]);

	// check if typewriter effect is completed
	const isCompleted = completedTypewriterHashes.has(contentHash);

	// if completed, disable typewriter effect
	const enableTypewriter = role === "agent" && !isCompleted;

	// when typewriter effect is completed, record to global Map
	const handleTypingComplete = () => {
		if (role === "agent" && !isCompleted) {
			completedTypewriterHashes.set(contentHash, true);
		}
		if (onTyping) {
			onTyping();
		}
	};

	const handleCopy = () => {
		navigator.clipboard.writeText(content);
	};

	return (
		<div
			key={id}
			className={`relative ${
				role === "agent" ? "bg-white-0% py-0" : "bg-white-80%"
			} w-full rounded-xl border px-4 py-3 ${className || ""} group`}
		>
			{role === "user" && (
				<div className="absolute bottom-[0px] right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
					<Button onClick={handleCopy} variant="ghost" size="icon">
						<Copy />
					</Button>
				</div>
			)}
			<MarkDown
				content={content}
				onTyping={handleTypingComplete}
				enableTypewriter={enableTypewriter && typewriter}
			/>
			{attaches && attaches.length > 0 && (
				<div className="flex gap-2 flex-wrap mt-[10px]">
					{attaches?.map((file) => {
						return (
							<div
								onClick={(e) => {
									e.stopPropagation();
									window.ipcRenderer.invoke("reveal-in-folder", file.filePath);
								}}
								key={"attache-" + file.fileName}
								className="cursor-pointer flex items-center gap-2 bg-message-fill-default border border-solid border-task-border-default rounded-[12px] px-2 py-1 w-[140px] "
							>
								<FileText size={24} className="flex-shrink-0" />
								<div className="flex flex-col">
									<div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
										{file?.fileName?.split(".")[0]}
									</div>
									<div className="font-medium leading-29 text-xs text-text-body">
										{file?.fileName?.split(".")[1]}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
