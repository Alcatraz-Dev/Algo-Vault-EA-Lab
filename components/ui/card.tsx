import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Card — FlyonUI `.card` surface with AlgoVault tokens (surface colour
 * `bg-card`, hairline border) plus premium depth: a soft resting shadow on
 * every card, stronger elevation for floating panels. `interactive` adds a
 * hover lift for clickable cards (transform/opacity only).
 */
const cardVariants = cva(
  "card group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl border bg-card text-sm/relaxed text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.05)] [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=lg]:[--card-spacing:--spacing(6)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
  {
    variants: {
      variant: {
        default: "border-border",
        elevated: "border-border shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)]",
        danger: "border-destructive/40 bg-destructive/5",
        interactive:
          "border-border transition-[box-shadow,border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-foreground/15 hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Card({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants> & { size?: "default" | "sm" | "lg" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        cardVariants({ variant }),
        "py-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-[13px] font-semibold tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-border p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
}
