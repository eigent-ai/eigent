// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { Copy, FileText } from "lucide-react";
import { MarkDown } from "./MarkDown";
import { useMemo } from "react";
import { Button } from "../../ui/button";

interface AgentMessageCardProps {
	id: string;
	content: string;
	className?: string;
	typewriter?: boolean;
	attaches?: File[];
	onTyping?: () => void;
}

// global Map to track completed typewriter effect content hash
const completedTypewriterHashes = new Map<string, boolean>();

export function AgentMessageCard({
	id,
	content,
	typewriter = true,
	onTyping,
	className,
	attaches,
}: AgentMessageCardProps) {
	// use content hash to track if typewriter effect is completed
	const contentHash = useMemo(() => {
		return `${id}-${content}`;
	}, [id, content]);

	// check if typewriter effect is completed
	const isCompleted = completedTypewriterHashes.has(contentHash);

	// if completed, disable typewriter effect
	const enableTypewriter = !isCompleted;

	// when typewriter effect is completed, record to global Map
	const handleTypingComplete = () => {
		if (!isCompleted) {
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
			className={`relative bg-white-0% w-full rounded-xl border px-sm py-3 ${className || ""} group overflow-hidden`}
		>
			<div className="absolute bottom-[0px] right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
				<Button onClick={handleCopy} variant="ghost" size="icon">
					<Copy />
				</Button>
			</div>
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
								className="cursor-pointer flex w-full items-center gap-2 bg-message-fill-default border border-solid border-task-border-default rounded-2xl pl-2 py-1 "
							>
								<FileText size={24} className="flex-shrink-0" />
								<div className="flex flex-col">
									<div className="max-w-48 font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
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

