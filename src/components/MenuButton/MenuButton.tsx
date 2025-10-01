import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const menuButtonVariants = cva(
	"relative inline-flex items-center justify-center select-none rounded-xs transition-colors duration-200 ease-in-out outline-none disabled:opacity-30 disabled:pointer-events-none bg-menu-button-fill-defualt border border-menu-button-border-default hover:bg-menu-button-fill-hover hover:border-menu-button-border-hover focus:bg-menu-button-fill-active focus:border-menu-button-border-active data-[state=on]:bg-menu-button-fill-active data-[state=on]:border-menu-button-border-active text-foreground cursor-pointer",
	{
		variants: {
			size: {
				sm: "p-2 gap-2 text-label-sm font-bold [&_svg]:size-[20px]",
				md: "p-2 gap-2 text-label-md font-bold [&_svg]:size-[24px]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	}
);

type MenuToggleContextValue = VariantProps<typeof menuButtonVariants>;

const MenuToggleGroupContext = React.createContext<MenuToggleContextValue>({
	size: "md",
});

type MenuToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof menuButtonVariants>;

export const MenuToggleGroup = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Root>,
	MenuToggleGroupProps
>(({ className, size, children, orientation = "vertical", ...props }, ref) => (
	<ToggleGroupPrimitive.Root
		ref={ref}
		orientation={orientation}
		className={cn(
			"flex items-center justify-center gap-1",
			orientation === "vertical" ? "flex-col" : "flex-row",
			className
		)}
		{...props}
	>
		<MenuToggleGroupContext.Provider value={{ size }}>
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
      };

export const MenuToggleItem = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Item>,
	MenuToggleItemProps
>(({ className, children, size, icon, subIcon, showSubIcon = false, ...props }, ref) => {
	const context = React.useContext(MenuToggleGroupContext);

	return (
		<ToggleGroupPrimitive.Item
			ref={ref}
			className={cn(menuButtonVariants({ size: context.size || size }), className)}
			{...props}
		>
			{showSubIcon && subIcon ? (
				<>
					<span className="inline-flex items-center gap-2">{children}</span>
					<span className="absolute right-1 top-1 inline-flex items-center justify-center [&_svg]:shrink-0">
						{subIcon}
					</span>
				</>
			) : (
				<span className="inline-flex items-center gap-2">
					{icon}
					{children}
				</span>
			)}
		</ToggleGroupPrimitive.Item>
	);
});

MenuToggleItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { menuButtonVariants };


