import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden shadow-sm rounded-md bg-off-white-100%  px-1.5 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/**
 * A simpler interface for Tooltip when you just need a trigger and content.
 * 
 * Usage:
 * ```jsx
 * <TooltipSimple content="This is a tooltip">
 *  <button>Hover me</button>
 * </TooltipSimple>
 * ```
 */
interface TooltipSimpleProps extends Omit<React.ComponentPropsWithoutRef<typeof TooltipContent>, 'children' | 'content'> {
  children: React.ReactNode;
  content: React.ReactNode;
}

const TooltipSimple = React.forwardRef<
  React.ElementRef<typeof TooltipContent>,
  TooltipSimpleProps
>(({ children, content, className, sideOffset = 4, ...props }, ref) => {
  return (
    <TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					{children}
				</TooltipTrigger>

        <TooltipContent ref={ref}
          sideOffset={sideOffset}
          className={cn(className)} 
          {...props}>
            {content}
        </TooltipContent >
			</Tooltip>
		</TooltipProvider>
	);
})

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipSimple }
