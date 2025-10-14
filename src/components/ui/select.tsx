import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type SelectSize = "default" | "sm"
// Only keep controllable states; hover/focus/default are automatic
export type SelectState = "error" | "success"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

// Local copies to mirror Input behavior for size/state without importing internal helpers
const sizeClasses: Record<SelectSize, string> = {
  default: "h-10 text-body-sm",
  sm: "h-8 text-body-sm",
}

function resolveStateClasses(state: SelectState | undefined, disabled: boolean) {
  if (disabled) {
    return {
      wrapper: "opacity-50 cursor-not-allowed",
      note: "text-text-label",
    }
  }
  if (state === "error") {
    return {
      wrapper: "",
      trigger: "border-input-border-caution bg-input-bg-default",
      note: "text-text-caution",
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
    trigger: "",
    note: "text-text-label",
  }
}

type SelectTriggerExtraProps = {
  size?: SelectSize
  state?: SelectState
  title?: string
  note?: string
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> &
    SelectTriggerExtraProps
>(({ className, children, size = "default", state, title, note, disabled, ...props }, ref) => {
  const stateCls = resolveStateClasses(state, Boolean(disabled))
  return (
    <div className={cn("w-full", stateCls.wrapper)}>
      {title ? (
        <div className="mb-1.5 text-body-sm font-bold text-text-heading">{title}</div>
      ) : null}
      <SelectPrimitive.Trigger
        ref={ref}
        disabled={disabled}
        className={cn(
          // Base styles
          "relative flex w-full items-center justify-between rounded-md border border-input-border-default border-solid outline-none transition-colors px-3 gap-2 text-text-body",
          sizeClasses[size],
          "[&>span]:line-clamp-1 whitespace-nowrap",
          // Default state (when no error/success)
          !state && "border-input-border-default bg-input-bg-default",
          // Interactive states (only when no error state)
          state !== "error" && [
            "hover:bg-input-bg-hover hover:border-input-border-hover",
            "focus-visible:ring-0 data-[state=open]:bg-input-bg-input",
            "focus-within:border-input-border-focus",
          ],
          // Validation states (override defaults)
          stateCls.trigger,
          // Placeholder styling
          "data-[placeholder]:text-input-label-default/50",
          className
        )}
        {...props}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 text-icon-primary" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      {note ? (
        <div className={cn("mt-1 text-xs", stateCls.note)}>{note}</div>
      ) : null}
    </div>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "bg-input-bg-default relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border border-solid border-input-border-default text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

type SelectItemWithButtonProps = {
  value: string
  label: React.ReactNode
  enabled: boolean
  buttonText?: string
  onButtonClick?: (e: React.MouseEvent) => void
  className?: string
}

const SelectItemWithButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  SelectItemWithButtonProps
>(({ value, label, enabled, buttonText = "Setting", onButtonClick, className, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    value={value}
    disabled={!enabled}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 group",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <div className="flex w-full items-center justify-between">
      <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      {!enabled && onButtonClick && (
        <Button
          variant="outline"
          size="sm"
          className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onButtonClick(e);
          }}
        >
          {buttonText}
        </Button>
      )}
    </div>
  </SelectPrimitive.Item>
))
SelectItemWithButton.displayName = "SelectItemWithButton"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectItemWithButton,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
