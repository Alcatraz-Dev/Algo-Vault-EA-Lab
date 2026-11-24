"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const MISSING_CONFIG_PREFIX = "Firebase client configuration is missing: ";
const SERVER_RENDER_MESSAGE =
    "Firebase client services cannot be accessed during server rendering.";

/**
 * Names of the missing Firebase env vars, or null when this is not a Firebase
 * configuration error. Shared wording with lib/firebase.ts, so the boundary can
 * turn the throw into the same actionable list the terminal diagnostic prints.
 */
function missingFirebaseEnvVars(error: Error): string[] | null {
    if (!error.message.startsWith(MISSING_CONFIG_PREFIX)) return null;

    return error.message
        .slice(MISSING_CONFIG_PREFIX.length)
        .replace(/\.$/, "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
}

/**
 * Route-level error boundary. Every app segment gets this instead of the raw
 * runtime overlay; the most common cause in a fresh checkout or worktree — a
 * missing Firebase client config — is reported as configuration, not a crash.
 */
export default function AppError({
    error,
    retry,
}: {
    error: Error & { digest?: string };
    retry: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    const missingVars = missingFirebaseEnvVars(error);
    const serverRenderIssue = error.message === SERVER_RENDER_MESSAGE;

    const title = missingVars
        ? "Firebase is not configured"
        : serverRenderIssue
          ? "This view needs the browser"
          : "Something went wrong";

    const description = missingVars
        ? "This environment has no Firebase client configuration, so sign-in and live data are unavailable. Add the variables below to .env.local in this project folder, then restart the dev server — worktrees and other checkouts do not share env files."
        : serverRenderIssue
          ? "Part of this page tried to reach Firebase during server rendering. Reload the page to let it render in the browser."
          : "The page failed to render. Try again, and if it keeps happening check the browser console for the underlying error.";

    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
            <Card className="w-full max-w-lg gap-4 rounded-xl border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.05)] sm:p-8">
                <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                <p className="text-sm leading-6 text-muted-foreground">{description}</p>

                {missingVars ? (
                    <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-4 font-numeric text-xs text-foreground">
                        {missingVars.map((name) => (
                            <li key={name}>{name}</li>
                        ))}
                    </ul>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" onClick={() => retry()}>
                        Try again
                    </Button>
                    <Button variant="outline" size="sm" render={<Link href="/" />}>
                        Go to home
                    </Button>
                </div>
            </Card>
        </main>
    );
}
