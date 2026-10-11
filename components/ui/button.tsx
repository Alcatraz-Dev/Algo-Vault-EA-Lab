import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Button — FlyonUI `.btn` base with AlgoVault variants.
 *
 * The FlyonUI component layer owns the visual treatment (depth, hover/active
 * transitions, border tinting); the size classes here pin the dense-product
 * control scale (36px default) on top of it. Brand/semantic colours come from
 * the theme bridge in `app/globals.css`, so nothing is hard-coded.
 */
const buttonVariants = cva(
  "btn group/button relative inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        outline: "btn-outline border-border text-foreground",
        secondary: "btn-secondary",
        ghost: "btn-text text-foreground",
        destructive: "btn-soft btn-error",
        link: "btn-text text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "h-9 w-9 px-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "h-7 w-7 px-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "h-8 w-8 px-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "h-10 w-10 px-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={nativeButton ?? (render ? false : true)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
