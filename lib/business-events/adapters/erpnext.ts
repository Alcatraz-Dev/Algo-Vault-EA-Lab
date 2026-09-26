import type { Adapter, AdapterResult } from "../dispatcher";
import type { BusinessEvent } from "../types";
import { isERPNextConfigured } from "../../integrations/erpnext/config";

export class ERPNextAdapter implements Adapter {
  async handle(event: BusinessEvent): Promise<AdapterResult> {
    const config = await import("../../integrations/erpnext/config").then((m) => m.loadERPNextConfig());
    if (!isERPNextConfigured(config)) {
      return { success: true }; // skipped intentionally
    }
    try {
      const client = await import("../../integrations/erpnext/client").then((m) => new m.ERPNextAPIClient());
      // Delegate to existing sync functions based on event type
      if (event.eventType === "customer.created" || event.eventType === "customer.updated") {
        const { syncCustomer } = await import("../../integrations/erpnext/customers");
        await syncCustomer(client, { userId: event.entity.id, ...event.payload } as any);
      } else if (event.eventType === "order.created" || event.eventType === "order.paid") {
        const { syncOrder, syncOrderPaid } = await import("../../integrations/erpnext/orders");
        if (event.eventType === "order.paid") await syncOrderPaid(client, event.payload as any);
        else await syncOrder(client, event.payload as any);
      }
      return { success: true };
    } catch (e) {
      return { success: false, errorCode: e instanceof Error ? e.message : String(e) };
    }
  }
}
