import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * FormField — canonical labeled form field with helper + error text.
 * Forms should communicate idle → validating → submitting → success/error,
 * and this keeps label/description/error presentation consistent.
 */
export function FormField({
  label,
  htmlFor,
  required,
  description,
  error,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-xs font-medium text-foreground"
      >
        {label}
        {required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
      </label>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}