import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Badge — FlyonUI `.badge` (dense `badge-sm` scale) with AlgoVault variants.
 * Colour comes from the FlyonUI theme bridge; the pill shape (`rounded-full`)
 * and dense type/size keep it in the product scale. Soft variants
 * (`badge-soft`) carry the low-opacity semantic tint used for statuses.
 */
const badgeVariants = cva(
  "badge badge-sm group/badge relative inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "badge-primary [a]:hover:brightness-95",
        secondary: "badge-secondary [a]:hover:brightness-95",
        destructive: "badge-soft badge-error",
        outline: "badge-outline border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
        success: "badge-soft badge-success",
        warning: "badge-soft badge-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
