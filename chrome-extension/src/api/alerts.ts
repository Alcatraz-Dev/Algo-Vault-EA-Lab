/**
 * Price alert management for the extension.
 *
 * Talks to the existing AlgoVault `/api/alerts` endpoints (same ones the web
 * app's Alert Center uses), so alerts created from the extension appear in the
 * user's dashboard and vice versa.
 */
import { getSettings, getAuthToken } from "@/storage/storage";
import type { ExtensionAlert, AlertType } from "@/types/copilot";

export interface CreateAlertInput {
  symbol: string;
  type: AlertType;
  targetPrice?: number;
  timeframe: string;
  message?: string;
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>): Promise<T> {
  const base = (await getSettings()).algovaultUrl;
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listAlerts(): Promise<ExtensionAlert[]> {
  const data = await request<{ success: boolean; alerts: ExtensionAlert[] }>("GET", "/api/alerts");
  return data.alerts ?? [];
}

export async function createAlert(input: CreateAlertInput): Promise<ExtensionAlert> {
  const data = await request<{ success: boolean; alert: ExtensionAlert }>("POST", "/api/alerts", {
    symbol: input.symbol,
    type: input.type,
    targetPrice: input.targetPrice ?? undefined,
    timeframe: input.timeframe || "H1",
    message: input.message || `${input.type.replace(/_/g, " ")} alert for ${input.symbol}`,
    notifyDiscord: true,
    notifyTelegram: true,
    notifyInApp: true,
  });
  return data.alert;
}

export async function deleteAlert(alertId: string): Promise<void> {
  await request("DELETE", "/api/alerts", { alertId });
}
