import type {
  ERPNextCustomer,
  ERPNextOrder,
  ERPNextInvoice,
  ERPNextPayment,
  ERPNextLicense,
  ERPNextCommission,
  CreateCustomerInput,
} from "./types";

export function mapCustomerToInput(
  externalIds: Record<string, string> = {},
  customer?: Partial<ERPNextCustomer>
): CreateCustomerInput {
  return {
    userId: externalIds["algovaultUserId"] ?? customer?.algovaultUserId ?? "",
    email: customer?.email,
    name: customer?.name,
    country: customer?.country,
    externalIds,
  };
}

export function buildExternalIds(
  base: Record<string, string> = {},
  extras?: Record<string, string>
): Record<string, string> {
  return { ...base, ...(extras ?? {}) };
}
