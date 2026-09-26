import type { Adapter, AdapterResult } from "../dispatcher";
import type { BusinessEvent } from "../types";
import { adminDatabase } from "@/lib/firebase-admin";

export class FirebaseAdapter implements Adapter {
  async handle(event: BusinessEvent): Promise<AdapterResult> {
    try {
      await adminDatabase.ref(`businessAudit/${event.entity.id}`).set({
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        eventId: event.eventId,
      });
      return { success: true };
    } catch (e) {
      return { success: false, errorCode: e instanceof Error ? e.message : String(e) };
    }
  }
}
