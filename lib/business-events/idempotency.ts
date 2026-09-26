import type { BusinessEvent } from "./types";

export class DuplicateEventError extends Error {
  constructor(key: string) {
    super(`Duplicate event for idempotency key: ${key}`);
    this.name = "DuplicateEventError";
  }
}

export function buildIdempotencyKey(event: BusinessEvent): string {
  return event.idempotencyKey;
}

export async function checkProcessed(key: string): Promise<boolean> {
  // In production, query event-store or RTDB for processed events with this key
  // For now, rely on event-store persistence and status checks
  try {
    const { getEvent } = await import("./event-store");
    // Simplified: assume caller checks before calling
    return false;
  } catch {
    return false;
  }
}
