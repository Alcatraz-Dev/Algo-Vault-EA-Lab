"use client";

/**
 * PanelErrorBoundary — Phase 5 §43.
 *
 * Every terminal rail is wrapped in its own boundary. A broken intelligence
 * module renders an inline "unavailable" state and the chart, watchlist,
 * positions and chat keep working. The boundary never swallows the error: it
 * logs it and shows the panel name plus a retry.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
    /** Shown to the user, e.g. "Intelligence". */
    name: string;
    children: ReactNode;
    /** Optional compact inline rendering instead of a full card. */
    compact?: boolean;
}

interface State {
    error: Error | null;
    attempt: number;
}

export class PanelErrorBoundary extends Component<Props, State> {
    state: State = { error: null, attempt: 0 };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error(`[terminal:${this.props.name}]`, error, info.componentStack);
    }

    private retry = () => {
        this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
    };

    render(): ReactNode {
        const { error, attempt } = this.state;
        if (!error) {
            // Keying on `attempt` remounts the subtree on retry.
            return <div key={attempt} className="contents">{this.props.children}</div>;
        }

        return (
            <div
                role="alert"
                className={
                    this.props.compact
                        ? "flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200"
                        : "rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
                }
            >
                <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                <div className={this.props.compact ? "min-w-0 flex-1" : "min-w-0 flex-1"}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                        {this.props.name} unavailable
                    </p>
                    {!this.props.compact ? (
                        <p className="mt-1 text-xs text-amber-200/80">
                            This panel failed to render. The rest of the terminal is unaffected.
                        </p>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={this.retry}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-background/60 px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-background"
                >
                    <RotateCcw className="size-3" />
                    Retry
                </button>
            </div>
        );
    }
}
