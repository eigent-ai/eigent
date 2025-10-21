import * as React from "react";

import {
	Tabs,
	TabsList,
	TabsTrigger,
	TabsContent,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type VerticalNavItem = {
	value: string;
	label: React.ReactNode;
	icon?: React.ReactNode;
	content?: React.ReactNode;
	disabled?: boolean;
};

export type VerticalNavigationProps = {
	items: VerticalNavItem[];
	defaultValue?: string;
	value?: string;
	onValueChange?: (value: string) => void;
	className?: string;
	listClassName?: string;
	triggerClassName?: string;
	contentClassName?: string;
};

export function VerticalNavigation({
	items,
	defaultValue,
	value,
	onValueChange,
	className,
	listClassName,
	triggerClassName,
	contentClassName,
}: VerticalNavigationProps) {
	const initial = React.useMemo(() => {
		if (value) return undefined;
		if (defaultValue) return defaultValue;
		return items[0]?.value;
	}, [value, defaultValue, items]);

	return (
		<Tabs
			orientation="vertical"
			value={value}
			defaultValue={initial}
			onValueChange={onValueChange}
			className={cn("flex w-full gap-4", className)}
		>
			<TabsList
				className={cn(
					"flex w-48 flex-col gap-1 bg-transparent p-0 border-0",
					listClassName
				)}
			>
				{items.map((item) => (
					<TabsTrigger
						key={item.value}
						value={item.value}
						disabled={item.disabled}
						className={cn(
								"justify-start gap-2 px-3 py-2 w-full rounded-lg text-sm",
								"bg-transparent data-[state=inactive]:bg-transparent",
								"data-[state=inactive]:text-menubutton-text-default data-[state=inactive]:opacity-70",
								"data-[state=inactive]:hover:bg-menubutton-fill-hover data-[state=inactive]:hover:opacity-100",
								"data-[state=active]:bg-menubutton-fill-active data-[state=active]:text-menutabs-text-active",
							triggerClassName
						)}
					>
						{item.icon ? (
							<span className="inline-flex h-4 w-4 items-center justify-center">
								{item.icon}
							</span>
						) : null}
						<span className="truncate">{item.label}</span>
					</TabsTrigger>
				))}
			</TabsList>

			<div className={cn("flex-1", contentClassName)}>
				{items.map((item) => (
					<TabsContent key={item.value} value={item.value} className="mt-0">
						{item.content}
					</TabsContent>
				))}
			</div>
		</Tabs>
	);
}

export default VerticalNavigation;


