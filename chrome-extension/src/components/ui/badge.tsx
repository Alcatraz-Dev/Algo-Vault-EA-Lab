import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        brand:
          "border-brand-500/40 bg-brand-500/10 text-brand-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive",
        success:
          "border-positive/40 bg-positive/10 text-positive",
        warning:
          "border-warning/40 bg-warning/10 text-warning",
        muted:
          "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
