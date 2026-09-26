import type { Adapter, AdapterResult } from "../dispatcher";
import type { BusinessEvent } from "../types";

export class LicensingAdapter implements Adapter {
  async handle(event: BusinessEvent): Promise<AdapterResult> {
    if (event.eventType === "license.activated" || event.eventType === "license.created") {
      // Delegate to existing licensing service — do NOT duplicate authorization logic
      // Existing AlgoVault Licensing Service remains authoritative for execution
    }
    return { success: true };
  }
}
