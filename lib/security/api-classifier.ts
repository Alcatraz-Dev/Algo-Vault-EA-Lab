/**
 * AlgoVault API Access Classifier & Authorization Verification Framework.
 * Categorizes endpoints to enforce strict server-side authorization boundaries.
 */

export type ApiClassification =
  | "PUBLIC"
  | "AUTHENTICATED"
  | "ADMIN"
  | "INTERNAL"
  | "CRON";

export interface RouteSecurityMetadata {
  classification: ApiClassification;
  description: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export const API_ROUTE_REGISTRY: Record<string, RouteSecurityMetadata> = {
  "/api/growth/cron": {
    classification: "CRON",
    description: "Scheduled background growth and marketing maintenance tasks.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10,
  },
  "/api/webhooks/stripe": {
    classification: "PUBLIC",
    description: "Stripe payment webhook receiver.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
  },
  "/api/webhooks/telegram": {
    classification: "PUBLIC",
    description: "Telegram bot update webhook receiver.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
  },
  "/api/ai": {
    classification: "AUTHENTICATED",
    description: "AI Terminal and Market Intelligence inference endpoints.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 30,
  },
  "/api/admin": {
    classification: "ADMIN",
    description: "Administrative operation and platform control APIs.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 20,
  },
  "/api/user": {
    classification: "AUTHENTICATED",
    description: "User profile, balance, and account preference APIs.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
  },
};

export function classifyApiRoute(pathname: string): RouteSecurityMetadata {
  for (const [prefix, meta] of Object.entries(API_ROUTE_REGISTRY)) {
    if (pathname.startsWith(prefix)) {
      return meta;
    }
  }

  if (pathname.startsWith("/api/admin")) {
    return {
      classification: "ADMIN",
      description: "Admin restricted API route.",
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
    };
  }

  if (pathname.startsWith("/api/cron")) {
    return {
      classification: "CRON",
      description: "Scheduled system task route.",
      rateLimitWindowMs: 60_000,
      rateLimitMax: 10,
    };
  }

  // Default fallback for unspecified API routes
  return {
    classification: "AUTHENTICATED",
    description: "Protected application API route.",
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
  };
}
