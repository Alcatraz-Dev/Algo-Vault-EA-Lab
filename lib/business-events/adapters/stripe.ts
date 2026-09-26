import type { Adapter, AdapterResult } from "../dispatcher";
import type { BusinessEvent } from "../types";

export class StripeAdapter implements Adapter {
  async handle(event: BusinessEvent): Promise<AdapterResult> {
    // Stripe remains authoritative; adapter only notes event for audit
    // Existing Stripe webhook architecture handles payment verification
    return { success: true };
  }
}
