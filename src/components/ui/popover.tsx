import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { ChevronDown, Check, CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { TooltipSimple } from "@/components/ui/tooltip"

export type PopoverSize = "default" | "sm"
export type PopoverState = "error" | "success"

const sizeClasses: Record<PopoverSize, string> = {
  default: "h-10 text-body-sm",
  sm: "h-8 text-body-sm",
}

function resolveStateClasses(state: PopoverState | undefined, disabled: boolean) {
  if (disabled) {
    return {
      wrapper: "opacity-50 cursor-not-allowed",
      trigger: "border-transparent",
      note: "text-text-label",
    }
  }
  if (state === "error") {
    return {
      wrapper: "",
      trigger: "border-input-border-cuation bg-input-bg-default",
      note: "text-text-cuation",
    }
  }
  if (state === "success") {
    return {
      wrapper: "",
      trigger: "border-input-border-success bg-input-bg-confirm",
      note: "text-text-success",
    }
  }
  return {
    wrapper: "",
    trigger: "border-transparent",
    note: "text-text-label",
  }
}

type PopoverProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> & {
  modal?: boolean
}

// Default modal to false to allow keyboard input within trigger
const Popover = ({ modal = false, ...props }: PopoverProps) => (
  <PopoverPrimitive.Root modal={modal} {...props} />
)

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverClose = PopoverPrimitive.Close

type PopoverTriggerExtraProps = {
  size?: PopoverSize
  state?: PopoverState
  title?: string
  tooltip?: string
  note?: string
  required?: boolean
  showChevron?: boolean
  leadingIcon?: React.ReactNode
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger> &
    PopoverTriggerExtraProps
>(({ 
  className, 
  children, 
  size = "default", 
  state, 
  title, 
  tooltip, 
  note, 
  required = false, 
  disabled,
  showChevron = true,
  leadingIcon,
  ...props 
}, ref) => {
  const stateCls = resolveStateClasses(state, Boolean(disabled))
  return (
    <div className={cn("w-full", stateCls.wrapper)}>
      {title ? (
        <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
          <span>{title}</span>
          {required && <span className="text-text-body">*</span>}
          {tooltip && (
            <TooltipSimple content={tooltip}>
              <CircleAlert size={16} className="text-icon-primary" />
            </TooltipSimple>
          )}
        </div>
      ) : null}
      <PopoverPrimitive.Trigger
        ref={ref}
        disabled={disabled}
        className={cn(
          // Base styles
          "relative flex w-full items-center justify-between rounded-lg border border-solid outline-none transition-all px-3 gap-2 text-text-body",
          sizeClasses[size],
          "[&>span]:line-clamp-1 whitespace-nowrap",
          // Default state (when no error/success)
          !state && "bg-input-bg-default",
          // Interactive states (only when no error/success state)
          state !== "error" &&
            state !== "success" && [
              "hover:bg-input-bg-hover hover:ring-1 hover:ring-input-border-hover hover:ring-offset-0",
              "focus-visible:ring-1 focus-visible:ring-input-border-focus focus-visible:ring-offset-0 data-[state=open]:bg-input-bg-input data-[state=open]:ring-1 data-[state=open]:ring-input-border-focus data-[state=open]:ring-offset-0",
            ],
          // Validation states (override defaults)
          stateCls.trigger,
          // Placeholder styling
          "data-[placeholder]:text-input-label-default/50",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {leadingIcon && (
            <span className="flex-shrink-0 text-icon-primary">
              {leadingIcon}
            </span>
          )}
          <span className="truncate">{children}</span>
        </div>
        {showChevron && (
          <ChevronDown className="h-4 w-4 text-icon-primary flex-shrink-0" />
        )}
      </PopoverPrimitive.Trigger>
      {note ? (
        <div className={cn("mt-1 text-xs", stateCls.note)}>{note}</div>
      ) : null}
    </div>
  )
})
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /**
   * When true, prevents the popover from closing when interacting outside.
   * Useful when the trigger contains an editable input.
   */
  preventCloseOnTriggerInteraction?: boolean
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ 
  className, 
  align = "start", 
  sideOffset = 4, 
  onWheel, 
  onTouchMove,
  onOpenAutoFocus,
  onInteractOutside,
  preventCloseOnTriggerInteraction = false,
  ...props 
}, ref) => {
  // Prevent scroll events from propagating to parent (e.g., dialog)
  const handleWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onWheel?.(e)
  }, [onWheel])

  const handleTouchMove = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onTouchMove?.(e)
  }, [onTouchMove])

  // Prevent auto focus to keep focus on input when popover opens
  const handleOpenAutoFocus = React.useCallback((e: Event) => {
    if (preventCloseOnTriggerInteraction) {
      e.preventDefault()
    }
    onOpenAutoFocus?.(e)
  }, [onOpenAutoFocus, preventCloseOnTriggerInteraction])

  // Prevent closing when clicking on trigger area (e.g., input inside trigger)
  const handleInteractOutside = React.useCallback((e: Parameters<NonNullable<typeof onInteractOutside>>[0]) => {
    if (preventCloseOnTriggerInteraction) {
      const target = e.target as HTMLElement
      // Check if the click is on the trigger or inside the trigger
      const trigger = target.closest('[data-radix-popover-trigger]')
      if (trigger) {
        e.preventDefault()
        return
      }
    }
    onInteractOutside?.(e)
  }, [onInteractOutside, preventCloseOnTriggerInteraction])

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onOpenAutoFocus={handleOpenAutoFocus}
        onInteractOutside={handleInteractOutside}
        className={cn(
          "bg-input-bg-default relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-solid border-transparent text-popover-foreground shadow-md",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          "w-[var(--radix-popover-trigger-width)]",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

type PopoverItemProps = React.HTMLAttributes<HTMLDivElement> & {
  selected?: boolean
  disabled?: boolean
}

const PopoverItem = React.forwardRef<HTMLDivElement, PopoverItemProps>(
  ({ className, children, selected, disabled, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover",
        disabled && "pointer-events-none opacity-50",
        selected && "bg-menutabs-fill-hover",
        className
      )}
      {...props}
    >
      {selected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
      {children}
    </div>
  )
)
PopoverItem.displayName = "PopoverItem"

type PopoverViewportProps = React.HTMLAttributes<HTMLDivElement> & {
  maxHeight?: string | number
}

const PopoverViewport = React.forwardRef<HTMLDivElement, PopoverViewportProps>(
  ({ className, maxHeight = 200, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("p-1 overflow-y-auto overflow-x-hidden", className)}
      style={{ 
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        ...style 
      }}
      {...props}
    />
  )
)
PopoverViewport.displayName = "PopoverViewport"

export { 
  Popover, 
  PopoverTrigger, 
  PopoverContent, 
  PopoverAnchor, 
  PopoverClose,
  PopoverItem,
  PopoverViewport,
}
