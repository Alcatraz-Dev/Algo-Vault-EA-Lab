"use client";

import { useEffect } from "react";

const MISSING_CONFIG_PREFIX = "Firebase client configuration is missing: ";

/**
 * Root error boundary. It replaces the root layout, so it must render its own
 * document and cannot rely on the app's CSS — everything here is inline and
 * follows the OS colour scheme.
 */
export default function GlobalError({
    error,
    retry,
}: {
    error: Error & { digest?: string };
    retry: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    const missingVars = error.message.startsWith(MISSING_CONFIG_PREFIX)
        ? error.message
              .slice(MISSING_CONFIG_PREFIX.length)
              .replace(/\.$/, "")
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean)
        : null;

    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "3rem 1rem",
                    background: "#0b0b0d",
                    color: "#f5f5f4",
                    fontFamily:
                        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
            >
                <div
                    style={{
                        maxWidth: "34rem",
                        border: "1px solid #2a2a2e",
                        borderRadius: "0.75rem",
                        background: "#131316",
                        padding: "1.75rem",
                    }}
                >
                    <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                        {missingVars ? "Firebase is not configured" : "Something went wrong"}
                    </h1>

                    <p
                        style={{
                            margin: "0.75rem 0 0",
                            fontSize: "0.875rem",
                            lineHeight: 1.6,
                            color: "#a1a1aa",
                        }}
                    >
                        {missingVars
                            ? "This environment has no Firebase client configuration. Add the variables below to .env.local in this project folder, then restart the dev server."
                            : "The application failed to start. Reloading sometimes helps; otherwise check the browser console and server logs."}
                    </p>

                    {missingVars ? (
                        <ul
                            style={{
                                margin: "1rem 0 0",
                                padding: "0.75rem 1rem 0.75rem 2rem",
                                border: "1px solid #2a2a2e",
                                borderRadius: "0.5rem",
                                background: "#0b0b0d",
                                fontSize: "0.75rem",
                                lineHeight: 1.8,
                                fontVariantNumeric: "tabular-nums",
                            }}
                        >
                            {missingVars.map((name) => (
                                <li key={name}>{name}</li>
                            ))}
                        </ul>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => retry()}
                        style={{
                            marginTop: "1.25rem",
                            border: 0,
                            borderRadius: "0.5rem",
                            background: "#f97316",
                            color: "#0b0b0d",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            padding: "0.5rem 0.9rem",
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
