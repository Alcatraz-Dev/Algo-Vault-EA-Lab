import type { BusinessEvent } from "./types";
import { persistEvent, updateEventStatus } from "./event-store";

export interface AdapterResult {
  success: boolean;
  errorCode?: string;
}

export interface Adapter {
  handle(event: BusinessEvent): Promise<AdapterResult>;
}

export class EventDispatcher {
  private adapters: Map<string, Adapter[]> = new Map();

  register(type: string, adapter: Adapter) {
    if (!this.adapters.has(type)) this.adapters.set(type, []);
    this.adapters.get(type)!.push(adapter);
  }

  async dispatch(event: BusinessEvent): Promise<AdapterResult[]> {
    await persistEvent(event);
    await updateEventStatus(event.eventId, "processing");

    const adapters = this.adapters.get(event.eventType) ?? [];
    const results: AdapterResult[] = [];

    for (const adapter of adapters) {
      try {
        const res = await adapter.handle(event);
        results.push(res);
      } catch (e) {
        results.push({ success: false, errorCode: e instanceof Error ? e.message : String(e) });
      }
    }

    const allSuccess = results.every((r) => r.success);
    await updateEventStatus(event.eventId, allSuccess ? "processed" : "failed");
    return results;
  }
}

export const dispatcher = new EventDispatcher();
