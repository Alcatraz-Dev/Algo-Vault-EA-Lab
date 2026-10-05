/**
 * Product Analytics — domain barrel.
 *
 * The pure modules (events, privacy, activation, funnel, retention,
 * experiments, upgrade-intent) have no I/O and are safe to import from both
 * client and server code. The `store` module touches the Admin SDK and is
 * intentionally NOT re-exported here so a client component can never pull
 * `firebase-admin` into the browser bundle — import it directly from
 * `lib/product-analytics/store` inside API routes and server components.
 */

export * from "./events";
export * from "./privacy";
export * from "./activation";
export * from "./funnel";
export * from "./retention";
export * from "./experiments";
export * from "./upgrade-intent";
