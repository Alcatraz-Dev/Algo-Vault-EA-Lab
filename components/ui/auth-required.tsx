"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AuthRequired — canonical signed-out state for a gated page.
 *
 * Several pages previously told the user "Sign in required" with no way to act on
 * it. This renders the same message with a real Sign in action that returns the
 * user to the page they were trying to reach (`/login?redirect=…`, which the
 * login page already honours).
 *
 * Sign in with Firebase is client-side, so the states are decided in the page;
 * this only owns the presentation of the signed-out case.
 */
export function AuthRequired({
  title = "Sign in required",
  description,
  icon,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const redirect = pathname && pathname !== "/" ? pathname : "/account";
  const href = `/login?redirect=${encodeURIComponent(redirect)}`;

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center",
        className
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Shield size={22} aria-hidden="true" />}
      </span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      <Link
        href={href}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Sign in
      </Link>
    </div>
  );
}
