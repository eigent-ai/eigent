import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ToggleGroupSlideItem {
	value: string;
	label: string;
	icon?: React.ReactNode;
	showSubIcon?: boolean;
	subIcon?: React.ReactNode;
}

interface ToggleGroupSlideProps {
	value: string;
	onValueChange: (value: string) => void;
	items: ToggleGroupSlideItem[];
	className?: string;
}

export const ToggleGroupSlide = React.forwardRef<
	HTMLDivElement,
	ToggleGroupSlideProps
>(({ value, onValueChange, items, className }, ref) => {
	const internalRef = React.useRef<HTMLDivElement>(null);
	const [indicatorStyle, setIndicatorStyle] = React.useState({
		left: 0,
		width: 0,
	});

	// Use callback ref to handle both forwarded ref and internal access
	const setRefs = React.useCallback(
		(node: HTMLDivElement | null) => {
			// Store in internal ref for our use
			(internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			// Forward ref
			if (typeof ref === "function") {
				ref(node);
			}
		},
		[ref]
	);

	// Calculate indicator position and width when value changes
	React.useEffect(() => {
		const container = internalRef.current;
		if (!container) return;

		const activeButton = container.querySelector(
			`[data-value="${value}"]`
		) as HTMLElement;
		if (!activeButton) return;

		const containerRect = container.getBoundingClientRect();
		const buttonRect = activeButton.getBoundingClientRect();

		setIndicatorStyle({
			left: buttonRect.left - containerRect.left,
			width: buttonRect.width,
		});
	}, [value, items]);

	return (
		<div
			ref={setRefs}
			className={cn(
				"relative flex items-center rounded-lg bg-surface-primary",
				className
			)}
		>
			{/* Animated sliding indicator */}
			<motion.div
				className="absolute top-1 bottom-1 bg-[#1d1d1d] rounded-md z-0"
				initial={false}
				animate={{
					left: indicatorStyle.left,
					width: indicatorStyle.width,
				}}
				transition={{
					type: "spring",
					stiffness: 300,
					damping: 30,
				}}
			/>

			{/* Toggle items */}
			{items.map((item) => {
				const isSelected = value === item.value;
				return (
					<button
						key={item.value}
						data-value={item.value}
						type="button"
						onClick={() => onValueChange(item.value)}
						className={cn(
							"relative z-10 flex items-center gap-1 bg-transparent px-2 py-1 rounded-md text-text-body transition-colors",
							isSelected
								? "text-[#ffffff]"
								: "text-text-label"
						)}
					>
						{item.icon && (
							<span className="w-4 h-4 flex items-center justify-center shrink-0">
								{item.icon}
							</span>
						)}
						<span>{item.label}</span>
						{item.showSubIcon && item.subIcon && (
							<span className="absolute right-1 top-1 inline-flex items-center justify-center">
								{item.subIcon}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
});

ToggleGroupSlide.displayName = "ToggleGroupSlide";
