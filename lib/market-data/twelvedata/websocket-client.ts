/**
 * Twelve Data WebSocket client.
 *
 * Maintains a single shared WebSocket connection for real-time price streaming.
 * Subscriptions are deduplicated per symbol. Reconnects automatically on
 * disconnect. Cleans up unused subscriptions.
 *
 * This runs server-side only (Next.js API routes / Node.js).
 * The API key is never exposed to the browser.
 */

import { TWELVE_DATA_CONFIG, getTwelveDataApiKey } from "./config";
import { SupportedSymbol } from "../types";
import { toTwelveDataSymbol } from "./symbol-map";

export type WebSocketPriceMessage = {
  event: string;
  symbol?: string;
  price?: number;
  size?: number;
  timestamp?: number;
  datetime?: string;
  bid?: number;
  ask?: number;
  spread?: number;
  exchange?: string;
};

export type WebSocketSubscribeAck = {
  event: string;
  symbol?: string;
  status?: string;
};

export type WebSocketErrorMessage = {
  event: string;
  error?: string;
  message?: string;
};

type PriceListener = (msg: WebSocketPriceMessage) => void;
type StatusListener = (status: "connected" | "disconnected" | "error", error?: string) => void;

interface PendingSubscription {
  symbol: SupportedSymbol;
  listeners: Set<PriceListener>;
}

class TwelveDataWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private statusListeners = new Set<StatusListener>();
  private subscriptions = new Map<SupportedSymbol, Set<PriceListener>>();
  private pendingSubscriptions = new Set<SupportedSymbol>();
  private connected = false;
  private connecting = false;
  private shouldConnect = true;

  private get apiKey(): string | undefined {
    return getTwelveDataApiKey();
  }

  private notifyStatus(status: "connected" | "disconnected" | "error", error?: string) {
    for (const listener of this.statusListeners) {
      try {
        listener(status, error);
      } catch (err) {
        console.error("[twelvedata-ws] status listener error", err);
      }
    }
  }

  connect(): void {
    if (this.connected || this.connecting) return;
    if (!this.apiKey) {
      console.warn("[twelvedata-ws] No API key, cannot connect");
      return;
    }

    this.connecting = true;
    this.shouldConnect = true;

    try {
      const url = `${TWELVE_DATA_CONFIG.wsUrl}?apikey=${encodeURIComponent(this.apiKey)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connecting = false;
        this.connected = true;
        this.reconnectDelay = 1000;
        this.notifyStatus("connected");
        this.flushSubscriptions();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketPriceMessage | WebSocketSubscribeAck | WebSocketErrorMessage;
          this.handleMessage(data);
        } catch (err) {
          console.error("[twelvedata-ws] Failed to parse message", err);
        }
      };

      this.ws.onerror = (err) => {
        this.notifyStatus("error", "WebSocket error");
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.connecting = false;
        this.notifyStatus("disconnected");
        this.scheduleReconnect();
      };
    } catch (err) {
      this.connecting = false;
      console.error("[twelvedata-ws] Connection error", err);
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: WebSocketPriceMessage | WebSocketSubscribeAck | WebSocketErrorMessage): void {
    if (data.event === "subscribe" || data.event === "unsubscribe") {
      return;
    }
    if (data.event === "error" || data.event === "rate_limit") {
      console.warn("[twelvedata-ws] Server event", data);
      return;
    }
    if (data.event === "price" && "symbol" in data && data.symbol) {
      const sym = this.resolveSymbol(data.symbol);
      if (sym) {
        const listeners = this.subscriptions.get(sym);
        if (listeners) {
          for (const listener of listeners) {
            try {
              listener(data);
            } catch (err) {
              console.error("[twelvedata-ws] listener error", err);
            }
          }
        }
      }
    }
  }

  private resolveSymbol(tdSymbol: string): SupportedSymbol | null {
    for (const [sym, td] of Object.entries(require("./symbol-map").TWELVE_DATA_SYMBOL_MAP) as [SupportedSymbol, string][]) {
      if (td.toUpperCase() === tdSymbol.toUpperCase()) return sym;
    }
    return null;
  }

  private flushSubscriptions(): void {
    for (const sym of this.pendingSubscriptions) {
      this.sendSubscribe(sym);
    }
    this.pendingSubscriptions.clear();
  }

  private sendSubscribe(sym: SupportedSymbol): void {
    const tdSymbol = toTwelveDataSymbol(sym);
    if (!tdSymbol || !this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ action: "subscribe", symbol: tdSymbol }));
  }

  private sendUnsubscribe(sym: SupportedSymbol): void {
    const tdSymbol = toTwelveDataSymbol(sym);
    if (!tdSymbol || !this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ action: "unsubscribe", symbol: tdSymbol }));
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  subscribe(
    symbol: SupportedSymbol,
    listener: PriceListener,
    onStatus?: StatusListener
  ): () => void {
    let listeners = this.subscriptions.get(symbol);
    if (!listeners) {
      listeners = new Set();
      this.subscriptions.set(symbol, listeners);
    }
    listeners.add(listener);

    if (onStatus) this.statusListeners.add(onStatus);

    if (!this.connected && !this.connecting) {
      this.connect();
    }

    if (this.connected) {
      this.sendSubscribe(symbol);
    } else {
      this.pendingSubscriptions.add(symbol);
    }

    const unsub = () => {
      listeners?.delete(listener);
      if (onStatus) this.statusListeners.delete(onStatus);

      if (listeners && listeners.size === 0) {
        this.subscriptions.delete(symbol);
        this.pendingSubscriptions.delete(symbol);
        this.sendUnsubscribe(symbol);
      }
    };

    return unsub;
  }

  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  is_connected(): boolean {
    return this.connected;
  }

  destroy(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState === 1) this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
    this.statusListeners.clear();
  }
}

export const twelveDataWebSocket = new TwelveDataWebSocket();