import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useState } from "react";

interface FeedbackCardProps {
	id: string;
	title: string;
	content: string;
	onConfirm?: () => void;
	onSkip?: () => void;
	className?: string;
}

export function FeedbackCard({
	id,
	title,
	content,
	onConfirm,
	onSkip,
	className,
}: FeedbackCardProps) {
	const [isHovered, setIsHovered] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(content);
	};

	return (
		<div
			key={id}
			className={`bg-message-fill-secondary w-full rounded-xl border px-4 py-3 flex flex-col gap-4 items-center justify-center relative group overflow-hidden ${className || ""}`}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Copy button - appears on hover */}
			<div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
				<Button onClick={handleCopy} variant="ghost" size="icon">
					<Copy className="w-4 h-4" />
				</Button>
			</div>

			{/* Title */}
			<p className="font-inter font-bold leading-normal text-sm text-text-body w-full">
				{title}
			</p>

			{/* Content */}
			<p className="font-inter font-medium leading-normal text-sm text-text-body w-full">
				{content}
			</p>

			{/* Action buttons */}
			<div className="flex gap-1 items-center w-full">
				<Button
					onClick={onConfirm}
					variant="primary"
					size="xs"
					className="flex-1"
				>
					Answer Agent
				</Button>
				<Button
					onClick={onSkip}
					variant="ghost"
					size="xs"
					className="flex-1"
				>
					Skip
				</Button>
			</div>
		</div>
	);
}
