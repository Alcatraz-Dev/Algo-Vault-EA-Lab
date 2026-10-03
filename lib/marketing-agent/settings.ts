/**
 * Marketing Agent — admin settings store (§89).
 *
 * Server-only. Feature flags gate every subsystem so a failing Hypit or
 * connector integration can be switched off without touching Growth,
 * Marketing Factory or the workflow engine (§90).
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { DEFAULT_AGENT_SETTINGS } from "./modes";
import type { MarketingAgentSettings } from "./types";

export const MARKETING_AGENT_SETTINGS_PATH = "marketingAgentSettings";

let cache: { value: MarketingAgentSettings; at: number } | null = null;
const CACHE_TTL_MS = 15_000;

/** Read settings with a short cache so a cron tick does not hammer RTDB. */
export async function loadSettingsFromRtdb(): Promise<MarketingAgentSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const snap = await adminDatabase.ref(MARKETING_AGENT_SETTINGS_PATH).get();
    const value = snap.exists()
      ? { ...DEFAULT_AGENT_SETTINGS, ...(snap.val() as Partial<MarketingAgentSettings>) }
      : DEFAULT_AGENT_SETTINGS;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Fail closed to the safe defaults rather than a permissive guess.
    return DEFAULT_AGENT_SETTINGS;
  }
}

export async function saveSettingsToRtdb(settings: MarketingAgentSettings, updatedBy: string): Promise<void> {
  await adminDatabase.ref(MARKETING_AGENT_SETTINGS_PATH).set({ ...settings, updatedAt: Date.now(), updatedBy });
  cache = { value: settings, at: Date.now() };
}

export function invalidateSettingsCache(): void {
  cache = null;
}
