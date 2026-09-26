import type {
  ERPNextCustomer,
  ERPNextOrder,
  ERPNextInvoice,
  ERPNextPayment,
  ERPNextLicense,
  ERPNextSubscription,
  ERPNextCommission,
  CreateCustomerInput,
  CreateOrderInput,
  CreateInvoiceInput,
  RecordPaymentInput,
  CreateLicenseInput,
  CreateCommissionInput,
} from "./types";

export const EXTERNAL_ID_PREFIX = {
  customer: "ALGOVAULT-CUSTOMER",
  product: "ALGOVAULT-ITEM",
  order: "ALGOVAULT-ORDER",
  invoice: "ALGOVAULT-INVOICE",
  payment: "ALGOVAULT-PAYMENT",
  refund: "ALGOVAULT-REFUND",
  license: "ALGOVAULT-LICENSE",
  subscription: "ALGOVAULT-SUBSCRIPTION",
  commission: "ALGOVAULT-COMMISSION",
} as const;

export function buildStableExternalId(prefix: string, id: string): string {
  return `${prefix}-${String(id || "").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

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

export function mapEntityReference(type: string, id: string): Record<string, string> {
  const key = Object.entries(EXTERNAL_ID_PREFIX).find(
    ([k]) => k.toLowerCase() === type.toLowerCase()
  )?.[1];
  return key ? { [type]: buildStableExternalId(key, id) } : {};
}
