import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { AnimateIcon as AnimateIconProvider } from "@/components/animate-ui/icons/icon";

const menuButtonVariants = cva(
	"relative inline-flex items-center justify-center select-none transition-colors duration-200 ease-in-out outline-none disabled:opacity-30 disabled:pointer-events-none bg-menubutton-fill-default hover:bg-menubutton-fill-hover data-[state=on]:bg-menubutton-fill-active cursor-pointer",
	{
		variants: {
			variant: {
				default: "border border-solid text-text-body border-menubutton-border-default hover:border-menubutton-border-hover focus:bg-menubutton-fill-active focus:border-menubutton-border-active data-[state=on]:border-menubutton-border-active data-[state=on]:shadow-button-shadow",
				clear: "border border-solid text-text-body border-menubutton-border-default hover:border-menubutton-border-hover focus:bg-menubutton-fill-active focus:border-menubutton-border-default data-[state=on]:shadow-button-shadow",
				info: "text-text-body !font-medium hover:bg-menubutton-fill-active focus:bg-menubutton-fill-active data-[state=on]:text-text-body data-[state=on]:!font-bold",
			},
			size: {
				xs: "px-2 py-1 text-label-sm font-bold [&_svg]:size-[16px] rounded-lg",
				sm: "p-2 gap-1 text-label-sm font-bold [&_svg]:size-[20px] rounded-lg",
				md: "w-10 h-10 text-label-md font-bold [&_svg]:size-[24px] rounded-xl",
				iconxs: "w-8 h-8 gap-1 font-bold [&_svg]:size-[16px] rounded-lg",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "md",
		},
	}
);

type MenuToggleContextValue = VariantProps<typeof menuButtonVariants>;

const MenuToggleGroupContext = React.createContext<MenuToggleContextValue>({
	variant: "default",
	size: "md",
});

type MenuToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof menuButtonVariants>;

export const MenuToggleGroup = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Root>,
	MenuToggleGroupProps
>(({ className, variant, size, children, orientation = "vertical", ...props }, ref) => (
	<ToggleGroupPrimitive.Root
		ref={ref}
		orientation={orientation}
		className={cn(
			"flex items-center justify-center",
			orientation === "vertical" ? "flex-col" : "flex-row",
			className
		)}
		{...props}
	>
		<MenuToggleGroupContext.Provider value={{ variant, size }}>
			{children}
		</MenuToggleGroupContext.Provider>
	</ToggleGroupPrimitive.Root>
));

MenuToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

type MenuToggleItemProps = React.ComponentPropsWithoutRef<
	typeof ToggleGroupPrimitive.Item
> & VariantProps<typeof menuButtonVariants> & {
	icon?: React.ReactNode;
	subIcon?: React.ReactNode;
	showSubIcon?: boolean;
	disableIconAnimation?: boolean;
	iconAnimateOnHover?: boolean | string;
};

export const MenuToggleItem = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Item>,
	MenuToggleItemProps
>(({ className, children, variant, size, icon, subIcon, showSubIcon = false, disableIconAnimation = false, iconAnimateOnHover = true, ...props }, ref) => {
	const context = React.useContext(MenuToggleGroupContext);
	const [isSelected, setIsSelected] = React.useState(false);
	const itemRef = React.useRef<HTMLButtonElement | null>(null);
	
	const combinedRef = React.useCallback(
		(node: HTMLButtonElement | null) => {
			itemRef.current = node;
			if (typeof ref === "function") {
				ref(node);
			} else if (ref) {
				// Use Object.defineProperty to bypass readonly restriction
				Object.defineProperty(ref, "current", {
					writable: true,
					value: node,
				});
			}
		},
		[ref]
	);

	React.useEffect(() => {
		const checkSelected = () => {
			if (itemRef.current) {
				const selected = itemRef.current.getAttribute("data-state") === "on";
				setIsSelected(selected);
			}
		};

		checkSelected();
		const observer = new MutationObserver(checkSelected);
		if (itemRef.current) {
			observer.observe(itemRef.current, {
				attributes: true,
				attributeFilter: ["data-state"],
			});
		}

		return () => observer.disconnect();
	}, []);

	const currentVariant = context.variant || variant;
	const isInfoVariant = currentVariant === "info";
	
	const iconNode = React.isValidElement(icon) && isInfoVariant
		? React.cloneElement(icon as React.ReactElement<any>, {
			strokeWidth: isSelected ? 2.5 : 2,
		})
		: icon;

	return (
		<AnimateIconProvider animateOnHover={disableIconAnimation ? false : (iconAnimateOnHover as unknown as string | boolean)} asChild>
			<ToggleGroupPrimitive.Item
				ref={combinedRef}
				className={cn("group", menuButtonVariants({ variant: currentVariant, size: context.size || size }), className)}
				{...props}
			>
				{showSubIcon && subIcon ? (
					<>
						<span className="inline-flex items-center gap-1">
							{iconNode}
							{children}
						</span>
						<span className="absolute right-1 top-1 inline-flex items-center justify-center [&_svg]:shrink-0">
							{subIcon}
						</span>
					</>
				) : (
					<span className="inline-flex items-center gap-1">
						{iconNode}
						{children}
					</span>
				)}
			</ToggleGroupPrimitive.Item>
		</AnimateIconProvider>
	);
});

MenuToggleItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { menuButtonVariants };


