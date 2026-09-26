import type { Adapter, AdapterResult } from "../dispatcher";
import type { BusinessEvent } from "../types";

export class AnalyticsAdapter implements Adapter {
  async handle(event: BusinessEvent): Promise<AdapterResult> {
    // Analytics/usage tracking — existing analytics infrastructure can consume
    return { success: true };
  }
}
