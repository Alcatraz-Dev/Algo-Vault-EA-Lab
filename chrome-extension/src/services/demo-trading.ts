/**
 * Demo (paper) trading engine — pure functions, no IO.
 *
 * Runs the same ticket math as the real Trade Ticket (risk-% sizing, market /
 * limit / stop entries, SL/TP) but executes every order against a simulated
 * account funded with the user's test capital. Prices come from the live
 * bid/ask quote, so fills, PnL and SL/TP hits behave like a real feed.
 *
 * Money convention (matches the Risk Calculator / Trade Ticket): 1.0 lot
 * moves the account $10 per 1.0 price unit → PnL = lots × distance × 10.
 */

export type DemoSide = "BUY" | "SELL";
export type DemoOrderKind = "market" | "limit" | "stop";
export type DemoPositionStatus = "pending" | "open" | "closed";
export type DemoCloseReason = "manual" | "sl" | "tp" | "breakeven" | "panic";

export interface DemoPosition {
  id: string;
  symbol: string;
  side: DemoSide;
  kind: DemoOrderKind;
  lots: number;
  /** Requested entry — the trigger for pending orders. */
  entry: number;
  /** Actual fill price once triggered (market fills use the live quote). */
  filledAt?: number;
  sl?: number;
  tp?: number;
  status: DemoPositionStatus;
  openedAt: number;
  filledAtMs?: number;
  closedAt?: number;
  exitPrice?: number;
  pnl?: number;
  /** Commission charged for this leg (deducted from pnl on close). */
  commission?: number;
  closeReason?: DemoCloseReason;
}

export interface DemoState {
  /** Starting test capital — what the user typed in. */
  startingCapital: number;
  /** Realized balance: starting capital + closed PnL. */
  balance: number;
  /** Optional per-lot commission in account currency (default 0). */
  commissionPerLot?: number;
  positions: DemoPosition[];
  createdAt: number;
  updatedAt: number;
}

export interface DemoQuote {
  bid: number;
  ask: number;
  /** Optional human label (broker/timeframe) shown in the panel. */
  label?: string;
}

/** Half-spread in price units — useful for UI hints and risk sizing. */
export function spreadOf(q: DemoQuote): number {
  return Math.max(0, q.ask - q.bid);
}

/** Distance to the configured stop-loss in price units; 0 if no SL. */
export function slDistanceOf(p: DemoPosition): number {
  if (p.sl == null || p.filledAt == null) return 0;
  return Math.abs(p.filledAt - p.sl);
}

/** Distance to the configured take-profit in price units; 0 if no TP. */
export function tpDistanceOf(p: DemoPosition): number {
  if (p.tp == null || p.filledAt == null) return 0;
  return Math.abs(p.filledAt - p.tp);
}

/* ── pure math ────────────────────────────────────────────────────────── */

/** PnL in account currency for `lots` over a price distance (gross, no commission). */
export function pnlForLots(lots: number, distance: number): number {
  return lots * distance * 10;
}

/** Commission charged for opening one position (`lots × commissionPerLot`). */
export function commissionFor(state: DemoState, lots: number): number {
  return Math.max(0, state.commissionPerLot ?? 0) * lots;
}

/** Floating PnL of one position at the current quote. */
export function floatingPnl(p: DemoPosition, q: DemoQuote): number {
  if (p.status !== "open" || !p.filledAt) return 0;
  const d = p.side === "BUY" ? q.bid - p.filledAt : p.filledAt - q.ask;
  return pnlForLots(p.lots, d);
}

/** Account equity at the current quote: balance + all floating PnL. */
export function equityOf(state: DemoState, q: DemoQuote): number {
  return (
    state.balance +
    state.positions
      .filter((p) => p.status === "open")
      .reduce((sum, p) => sum + floatingPnl(p, q), 0)
  );
}

export interface DemoStats {
  closed: number;
  wins: number;
  losses: number;
  breaks: number; // closed at exactly 0 PnL
  winRate: number;
  realizedPnl: number;
  bestPnl: number;
  worstPnl: number;
  avgWin: number;
  avgLoss: number;
  /** grossWins / |grossLosses| — NaN-safe and 0 when no losses. */
  profitFactor: number;
  /** avg pnl per closed trade (closed > 0). */
  expectancy: number;
}

/** Closed-trade stats used by the account strip + dashboard chips. */
export function statsOf(state: DemoState): DemoStats {
  const closed = state.positions.filter((p) => p.status === "closed" && p.pnl != null);
  const pnls = closed.map((p) => p.pnl ?? 0);
  const wins = pnls.filter((v) => v > 0);
  const losses = pnls.filter((v) => v < 0);
  const breaks = pnls.filter((v) => v === 0).length;
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = losses.reduce((s, v) => s + v, 0); // negative
  const profitFactor = grossLoss < 0 ? grossWin / Math.abs(grossLoss) : grossWin > 0 ? Infinity : 0;
  const realizedPnl = pnls.reduce((s, v) => s + v, 0);
  return {
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    breaks,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    realizedPnl,
    bestPnl: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstPnl: pnls.length > 0 ? Math.min(...pnls) : 0,
    avgWin: wins.length > 0 ? grossWin / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor,
    expectancy: closed.length > 0 ? realizedPnl / closed.length : 0,
  };
}

/**
 * Lightweight equity-curve points for the dashboard sparkline. Walks closed
 * trades in chronological order, starting from `startingCapital`, and adds
 * each realized PnL. The last point also adds floating PnL so the line
 * reflects live equity, not just booked PnL.
 */
export function equityCurve(state: DemoState, q?: DemoQuote): Array<{ t: number; equity: number }> {
  const points: Array<{ t: number; equity: number }> = [
    { t: state.createdAt, equity: state.startingCapital },
  ];
  let running = state.startingCapital;
  const closedSorted = state.positions
    .filter((p) => p.status === "closed" && p.pnl != null)
    .sort((a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? b.openedAt));
  for (const p of closedSorted) {
    running += p.pnl ?? 0;
    points.push({ t: p.closedAt ?? Date.now(), equity: running });
  }
  if (q) {
    const floating = state.positions
      .filter((pos) => pos.status === "open")
      .reduce((s, pos) => s + floatingPnl(pos, q), 0);
    points.push({ t: Date.now(), equity: running + floating });
  }
  return points;
}

/* ── validation (shared with the real ticket's rules) ─────────────────── */

export interface TicketInput {
  side: DemoSide;
  kind: DemoOrderKind;
  /** Live price used to validate pending orders. */
  live: number;
  /** Optional half-spread in price units (e.g. `ask - bid` / 2). Pending
   *  orders must sit outside the live spread, not just outside the mid. */
  spread?: number;
  entry: number;
  sl: number;
  tp: number;
}

export function validateTicket(t: TicketInput): { ok: boolean; error?: string } {
  const { side, kind, live, entry, sl, tp } = t;
  if (entry <= 0) return { ok: false, error: "Entry price is required." };
  if (sl > 0 && tp > 0 && tp === sl) {
    return { ok: false, error: "Take profit and stop loss cannot be the same price." };
  }

  // The "market" boundary for a pending order is the *far* side of the spread:
  // a BUY LIMIT below the bid (not below the mid) and a SELL STOP below the
  // ask — anything inside the spread would fill immediately and isn't a real
  // pending order. spread is optional for backwards compatibility.
  const halfSpread = Math.max(0, t.spread ?? 0) / 2;
  const buyBoundary = live > 0 ? live + halfSpread : live; // highest a buy can sit and still be pending
  const sellBoundary = live > 0 ? live - halfSpread : live; // lowest a sell can sit and still be pending

  if (kind === "limit" && live > 0) {
    // Buy limit must sit below the market, sell limit above it.
    if (side === "BUY" && entry >= buyBoundary)
      return { ok: false, error: `BUY LIMIT must be below the bid (≤ ${buyBoundary.toFixed(5)}). Use a STOP above.` };
    if (side === "SELL" && entry <= sellBoundary)
      return { ok: false, error: `SELL LIMIT must be above the ask (≥ ${sellBoundary.toFixed(5)}). Use a STOP below.` };
  }
  if (kind === "stop" && live > 0) {
    if (side === "BUY" && entry <= buyBoundary)
      return { ok: false, error: `BUY STOP must be above the ask (≥ ${buyBoundary.toFixed(5)}). Use a LIMIT below.` };
    if (side === "SELL" && entry >= sellBoundary)
      return { ok: false, error: `SELL STOP must be below the bid (≤ ${sellBoundary.toFixed(5)}). Use a LIMIT above.` };
  }
  if (sl > 0) {
    if (side === "BUY" && sl >= entry) return { ok: false, error: "Stop loss must be below the entry for a BUY." };
    if (side === "SELL" && sl <= entry) return { ok: false, error: "Stop loss must be above the entry for a SELL." };
  }
  if (tp > 0) {
    if (side === "BUY" && tp <= entry) return { ok: false, error: "Take profit must be above the entry for a BUY." };
    if (side === "SELL" && tp >= entry) return { ok: false, error: "Take profit must be below the entry for a SELL." };
  }
  return { ok: true };
}

/** MT5-style action for an order, derived from kind + market context. */
export function orderAction(kind: DemoOrderKind, side: DemoSide): string {
  if (kind === "market") return side;
  return `${side}_${kind.toUpperCase()}`; // BUY_LIMIT / SELL_LIMIT / BUY_STOP / SELL_STOP
}

/**
 * When the trader flips BUY↔SELL we want to keep their SL/TP *distances* but
 * mirror them across the entry. Returns the new SL/TP pair; either field is
 * `undefined` if the input was unset so the caller can detect "no SL yet".
 */
export function mirrorSlTp(
  side: DemoSide,
  entry: number,
  sl: number | undefined,
  tp: number | undefined,
): { sl?: number; tp?: number } {
  const mirror = (price: number | undefined): number | undefined => {
    if (price == null) return undefined;
    const d = price - entry; // signed distance from entry
    return entry - d;
  };
  return { sl: mirror(sl), tp: mirror(tp) };
}

/* ── state transitions ───────────────────────────────────────────────── */

export function createDemoState(startingCapital: number, commissionPerLot = 0): DemoState {
  const now = Date.now();
  return {
    startingCapital,
    balance: startingCapital,
    commissionPerLot: commissionPerLot > 0 ? commissionPerLot : undefined,
    positions: [],
    createdAt: now,
    updatedAt: now,
  };
}

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % 1_000_000;
  return `demo_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export interface PlaceDemoOrderArgs {
  state: DemoState;
  symbol: string;
  side: DemoSide;
  kind: DemoOrderKind;
  lots: number;
  entry: number;
  sl?: number;
  tp?: number;
  quote: DemoQuote;
  now?: number;
}

/**
 * Queue a demo order. Market orders fill immediately at the current quote
 * (BUY at ask, SELL at bid); limit/stop orders park as pending and are
 * triggered by markDemoState when the market crosses them. Commission is
 * recorded on the position so it can be netted out of PnL on close.
 */
export function placeDemoOrder(args: PlaceDemoOrderArgs): { state: DemoState; position: DemoPosition } {
  const { state, symbol, side, kind, quote } = args;
  const now = args.now ?? Date.now();
  const lots = Math.max(0.01, Math.round(args.lots * 100) / 100);
  const sl = args.sl && args.sl > 0 ? args.sl : undefined;
  const tp = args.tp && args.tp > 0 ? args.tp : undefined;
  const commission = round2(commissionFor(state, lots));

  const base: DemoPosition = {
    id: nextId(),
    symbol,
    side,
    kind,
    lots,
    entry: args.entry,
    sl,
    tp,
    commission,
    status: "pending",
    openedAt: now,
  };

  if (kind === "market") {
    const fill = side === "BUY" ? quote.ask : quote.bid;
    const position: DemoPosition = { ...base, status: "open", filledAt: fill, filledAtMs: now };
    return {
      state: { ...state, positions: [...state.positions, position], updatedAt: now },
      position,
    };
  }

  return {
    state: { ...state, positions: [...state.positions, base], updatedAt: now },
    position: base,
  };
}

export function cancelDemoOrder(state: DemoState, id: string): DemoState {
  return {
    ...state,
    positions: state.positions.filter((p) => !(p.id === id && p.status === "pending")),
    updatedAt: Date.now(),
  };
}

/** Cancel every pending order in one shot; used by the "cancel all" panic button. */
export function cancelAllPending(state: DemoState, now: number = Date.now()): DemoState {
  let changed = false;
  const positions = state.positions.map((p) => {
    if (p.status !== "pending") return p;
    changed = true;
    return p;
  }).filter((p) => p.status !== "pending");
  if (!changed) return state;
  return { ...state, positions, updatedAt: now };
}

export function closeDemoPosition(
  state: DemoState,
  id: string,
  quote: DemoQuote,
  reason: DemoCloseReason = "manual",
  now: number = Date.now()
): DemoState {
  let realized = 0;
  const positions = state.positions.map((p) => {
    if (p.id !== id || p.status !== "open" || !p.filledAt) return p;
    const exit = p.side === "BUY" ? quote.bid : quote.ask;
    const gross = pnlForLots(p.lots, p.side === "BUY" ? exit - p.filledAt : p.filledAt - exit);
    const pnl = round2(gross - (p.commission ?? 0));
    realized += pnl;
    return { ...p, status: "closed" as const, exitPrice: exit, pnl, closeReason: reason, closedAt: now };
  });
  return { ...state, positions, balance: round2(state.balance + realized), updatedAt: now };
}

/**
 * Close every open position in a single call. Useful as a panic button or to
 * flatten exposure before a session break. Returns the next state plus a
 * small summary so the UI can announce "closed N positions · +$X.XX".
 */
export function closeAllPositions(
  state: DemoState,
  quote: DemoQuote,
  reason: DemoCloseReason = "manual",
  now: number = Date.now()
): { state: DemoState; closedCount: number; realizedPnl: number } {
  let realized = 0;
  let closedCount = 0;
  const positions = state.positions.map((p): DemoPosition => {
    if (p.status !== "open" || !p.filledAt) return p;
    const exit = p.side === "BUY" ? quote.bid : quote.ask;
    const gross = pnlForLots(p.lots, p.side === "BUY" ? exit - p.filledAt : p.filledAt - exit);
    const pnl = round2(gross - (p.commission ?? 0));
    realized += pnl;
    closedCount += 1;
    return { ...p, status: "closed" as const, exitPrice: exit, pnl, closeReason: reason, closedAt: now };
  });
  return {
    state: closedCount === 0
      ? state
      : { ...state, positions, balance: round2(state.balance + realized), updatedAt: now },
    closedCount,
    realizedPnl: realized,
  };
}

/**
 * Move an open position's stop-loss to its fill price (breakeven). Returns
 * the updated state, or `null` when the move isn't valid — used by the "BE"
 * inline button so the caller can show a clear error when the SL is missing
 * or the position is no longer open.
 */
export function moveSlToBreakeven(
  state: DemoState,
  id: string,
  now: number = Date.now(),
): DemoState | null {
  let touched = false;
  const positions = state.positions.map((p) => {
    if (p.id !== id || p.status !== "open" || p.filledAt == null) return p;
    touched = true;
    return { ...p, sl: p.filledAt };
  });
  if (!touched) return null;
  return { ...state, positions, updatedAt: now };
}

/**
 * Clone an existing closed/pending position into a fresh pending order,
 * preserving side, lots, SL/TP distance, etc. Useful for the "duplicate"
 * button on the history row. New pending order parks at the same `entry`
 * price; the live feed then triggers / expires it like any other pending.
 */
export function duplicatePosition(
  state: DemoState,
  sourceId: string,
  quote: DemoQuote,
  overrides: Partial<Pick<DemoPosition, "side" | "lots" | "entry" | "sl" | "tp">> = {},
  now: number = Date.now(),
): { state: DemoState; position: DemoPosition } | null {
  const src = state.positions.find((p) => p.id === sourceId);
  if (!src) return null;
  const side = overrides.side ?? src.side;
  const lots = overrides.lots ?? src.lots;
  const entry = overrides.entry ?? (src.kind === "market" ? (side === "BUY" ? quote.ask : quote.bid) : src.entry);
  const sl = overrides.sl !== undefined ? overrides.sl : src.sl;
  const tp = overrides.tp !== undefined ? overrides.tp : src.tp;
  return placeDemoOrder({
    state,
    symbol: src.symbol,
    side,
    kind: src.kind,
    lots,
    entry,
    sl,
    tp,
    quote,
    now,
  });
}

/**
 * Advance the simulation with a fresh quote: triggers pending limit/stop
 * orders and closes open positions whose SL/TP is touched.
 *
 * `symbol` scopes the quote: positions on other symbols are left untouched
 * so switching the chart never marks old trades against the wrong price.
 * Returns the original object when nothing changed, so callers can skip
 * redundant persistence writes.
 */
export function markDemoState(state: DemoState, quote: DemoQuote, now: number = Date.now(), symbol?: string): DemoState {
  let balance = state.balance;
  let changed = false;
  const positions = state.positions.map((p): DemoPosition => {
    if (symbol && p.symbol !== symbol) return p;

    /* 1. pending → open when the market crosses the trigger */
    if (p.status === "pending") {
      const triggered = isTriggered(p, quote);
      if (!triggered) return p;
      changed = true;
      // Slippage guard: a gap can blow through the trigger — fill at the
      // trigger for limits (price improvement never happens on limit), and
      // at the current price for stops (realistic slippage on gaps).
      const fill = p.kind === "limit" ? p.entry : p.side === "BUY" ? quote.ask : quote.bid;
      return { ...p, status: "open", filledAt: fill, filledAtMs: now };
    }

    /* 2. open → SL/TP hits */
    if (p.status === "open" && p.filledAt) {
      const exitPrice = slTpHit(p, quote);
      if (exitPrice != null) {
        changed = true;
        const gross = pnlForLots(p.lots, p.side === "BUY" ? exitPrice - p.filledAt : p.filledAt - exitPrice);
        const pnl = round2(gross - (p.commission ?? 0));
        const reason: DemoCloseReason = p.sl != null && exitPrice === p.sl ? "sl" : "tp";
        balance = round2(balance + pnl);
        return { ...p, status: "closed", exitPrice, pnl, closeReason: reason, closedAt: now };
      }
    }
    return p;
  });

  return changed ? { ...state, positions, balance, updatedAt: now } : state;
}

function isTriggered(p: DemoPosition, q: DemoQuote): boolean {
  if (p.side === "BUY") {
    return p.kind === "limit" ? q.ask <= p.entry : q.ask >= p.entry;
  }
  return p.kind === "limit" ? q.bid >= p.entry : q.bid <= p.entry;
}

/** Returns the exit price when SL/TP is touched, else null. */
function slTpHit(p: DemoPosition, q: DemoQuote): number | null {
  if (!p.filledAt) return null;
  if (p.side === "BUY") {
    if (p.sl != null && q.bid <= p.sl) return p.sl;
    if (p.tp != null && q.bid >= p.tp) return p.tp;
  } else {
    if (p.sl != null && q.ask >= p.sl) return p.sl;
    if (p.tp != null && q.ask <= p.tp) return p.tp;
  }
  return null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
