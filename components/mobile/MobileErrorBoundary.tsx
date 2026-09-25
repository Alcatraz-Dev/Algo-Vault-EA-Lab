"use client";

import { useEffect, useState, Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

export class MobileErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[MobileErrorBoundary] Caught error:", error, errorInfo);
    this.props.onError?.(error);
  }

  resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col min-h-screen bg-background items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 pb-8 px-6 text-center">
              <AlertTriangle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
              <p className="text-sm text-muted-foreground mb-6">
                {this.state.error?.message || "An unexpected error occurred. Please try again."}
              </p>
              <div className="flex gap-2 justify-center">
                <Button 
                  variant="default" 
                  onClick={this.resetErrorBoundary}
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Link
                  href="/mobile/home"
                  className={cn(
                    "inline-flex items-center justify-center flex-1 h-9 rounded-md px-3 text-sm font-medium",
                    "border border-border bg-background hover:bg-muted",
                    "transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                    "disabled:pointer-events-none disabled:opacity-50"
                  )}
                >
                  <Home className="h-4 w-4 mr-2" />
                  Go Home
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withMobileErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <MobileErrorBoundary fallback={fallback}>
        <Component {...props} />
      </MobileErrorBoundary>
    );
  };
}

export function MobileErrorFallback({ 
  error, 
  resetErrorBoundary, 
  title = "Something went wrong",
  description = "An unexpected error occurred. Please try again.",
  showHomeLink = true
}: {
  error: Error | null;
  resetErrorBoundary: () => void;
  title?: string;
  description?: string;
  showHomeLink?: boolean;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-background items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 pb-8 px-6 text-center">
          <AlertTriangle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {error?.message || description}
          </p>
          <div className="flex gap-2 justify-center">
            <Button 
              variant="default" 
              onClick={resetErrorBoundary}
              className="flex-1"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            {showHomeLink && (
              <Link
                href="/mobile/home"
                className={cn(
                  "inline-flex items-center justify-center flex-1 h-9 rounded-md px-3 text-sm font-medium",
                  "border border-border bg-background hover:bg-muted",
                  "transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
              >
                <Home className="h-4 w-4 mr-2" />
                Go Home
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
    );
}