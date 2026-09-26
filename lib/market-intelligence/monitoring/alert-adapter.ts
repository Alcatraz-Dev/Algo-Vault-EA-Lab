/** Alert adapter — uses existing notification/infrastructure only. No new provider. */
export type AlertSeverity = "INFO" | "EVENT" | "SETUP" | "SYSTEM";
export interface AlertConfig { eventType?: string; setupState?: string; destination?: string; cooldownMs?: number; severity?: AlertSeverity; }
export function shouldNotify(cfg: AlertConfig, event?: any): boolean {
  // Deterministic dedup check placeholder; real dedup uses existing infrastructure
  return !!event && !!cfg.eventType;
}
