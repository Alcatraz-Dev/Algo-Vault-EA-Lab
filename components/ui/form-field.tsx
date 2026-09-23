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

/** Inline error banner for form-level validation/submission errors. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
    >
      {children}
    </div>
  );
}

/** Inline success banner after a successful save. */
export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success-foreground"
    >
      {children}
    </div>
  );
}