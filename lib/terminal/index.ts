/**
 * AlgoVault Terminal — Phase 5 shared workspace layer.
 *
 * Pure, framework-free modules that back the terminal UI:
 *   types       — the state/context/event contracts
 *   workspaces  — the view presets (Scalping … Paper Trading)
 *   state       — defaults, sanitising, watchlist operations, encode/decode
 *   events      — projections of engine payloads into one event feed
 *   chat-context— the structured trading-chat payload + prompt instructions
 *
 * Nothing here performs I/O. React lives in `components/terminal/`.
 */

export * from "./types";
export * from "./workspaces";
export * from "./state";
export * from "./events";
export * from "./chat-context";
