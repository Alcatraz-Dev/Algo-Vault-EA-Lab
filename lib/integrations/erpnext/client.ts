import {
  ERPNextNotEnabledError,
  ERPNextNotReachableError,
  ERPNextAuthError,
  ERPNextSyncError,
} from "./errors";
import { loadERPNextConfig, isERPNextConfigured } from "./config";
import type {
  ERPNextCustomer,
  ERPNextOrder,
  ERPNextInvoice,
  ERPNextPayment,
  ERPNextLicense,
  ERPNextCommission,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateOrderInput,
  CreateInvoiceInput,
  RecordPaymentInput,
  CreateLicenseInput,
  CreateCommissionInput,
} from "./types";

export interface ERPNextClient {
  createCustomer(input: CreateCustomerInput): Promise<ERPNextCustomer>;
  updateCustomer(input: UpdateCustomerInput): Promise<ERPNextCustomer>;
  createOrder(input: CreateOrderInput): Promise<ERPNextOrder>;
  createInvoice(input: CreateInvoiceInput): Promise<ERPNextInvoice>;
  recordPayment(input: RecordPaymentInput): Promise<ERPNextPayment>;
  createLicenseRecord(input: CreateLicenseInput): Promise<ERPNextLicense>;
  createCommission(input: CreateCommissionInput): Promise<ERPNextCommission>;
  healthCheck(): Promise<{ enabled: boolean; reachable: boolean; lastSyncAt?: string; pendingEvents: number; failedEvents: number }>;
}

export function buildBasicAuthHeader(config: { apiKey: string; apiSecret: string }): string {
  if (typeof Buffer !== "undefined") {
    return "Basic " + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
  }
  // Fallback for environments without Buffer (should not occur server-side)
  return "Basic " + btoa(`${config.apiKey}:${config.apiSecret}`);
}

export async function checkERPNextHealth(config: { baseUrl: string; apiKey: string; apiSecret: string }): Promise<{ reachable: boolean; lastSyncAt?: string; pendingEvents: number; failedEvents: number }> {
  if (!config.baseUrl) return { reachable: false, pendingEvents: 0, failedEvents: 0 };
  try {
    const url = `${config.baseUrl.replace(/\/$/, "")}/api/resource/User?limit=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: buildBasicAuthHeader(config),
        "Content-Type": "application/json",
      },
    });
    return {
      reachable: res.ok,
      pendingEvents: 0,
      failedEvents: 0,
    };
  } catch {
    return { reachable: false, pendingEvents: 0, failedEvents: 0 };
  }
}

export class ERPNextAPIClient implements ERPNextClient {
  private config: ReturnType<typeof loadERPNextConfig>;

  constructor() {
    this.config = loadERPNextConfig();
  }

  private getHeaders(): Record<string, string> {
    if (!isERPNextConfigured(this.config)) {
      throw new ERPNextNotEnabledError();
    }
    return {
      Authorization: buildBasicAuthHeader({ apiKey: this.config.apiKey, apiSecret: this.config.apiSecret }),
      "Content-Type": "application/json",
    };
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    if (!this.config.baseUrl) throw new ERPNextNotReachableError(this.config.baseUrl || "");
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ERPNextSyncError(`ERPNext POST ${path} failed: ${res.status} - ${text}`);
    }
    return (await res.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.config.baseUrl) throw new ERPNextNotReachableError(this.config.baseUrl || "");
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ERPNextSyncError(`ERPNext GET ${path} failed: ${res.status} - ${text}`);
    }
    return (await res.json()) as T;
  }

  async healthCheck(): Promise<{ enabled: boolean; reachable: boolean; lastSyncAt?: string; pendingEvents: number; failedEvents: number }> {
    const health = await checkERPNextHealth({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey, apiSecret: this.config.apiSecret });
    return {
      enabled: isERPNextConfigured(this.config),
      reachable: health.reachable,
      pendingEvents: health.pendingEvents,
      failedEvents: health.failedEvents,
      lastSyncAt: health.lastSyncAt,
    };
  }

  async createCustomer(input: CreateCustomerInput): Promise<ERPNextCustomer> {
    // Idempotent approach: search by external ID first
    const filters = input.externalIds ? `?filters=[["algovaultUserId","=","${input.userId}"]]` : `?filters=[["customer_name","=","${input.name ?? input.userId}"]]`;
    try {
      const existing = await this.get<{ data?: Array<{ name: string; customer_name?: string; email_id?: string }> }>(
        `/api/resource/AlgoVault Customer${filters}`
      );
      if (existing?.data && existing.data.length > 0) {
        const row = existing.data[0];
        return {
          name: row.customer_name || row.name || input.name || input.userId,
          algovaultUserId: input.userId,
          email: row.email_id,
        };
      }
    } catch {
      // If resource doesn't exist or search fails, continue to create
    }

    const payload = {
      customer_name: input.name || input.userId,
      customer_type: "Individual",
      algovault_user_id: input.userId,
      email_id: input.email,
      country: input.country,
      customer_group: "Individual",
    };
    try {
      const result = await this.post<{ data: { name: string; customer_name?: string; email_id?: string } }>("/api/resource/AlgoVault Customer", payload);
      const row = result.data;
      return {
        name: row.customer_name || row.name || input.name || input.userId,
        algovaultUserId: input.userId,
        email: row.email_id,
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to create customer for user ${input.userId}`, "customer", input.userId);
    }
  }

  async updateCustomer(input: UpdateCustomerInput): Promise<ERPNextCustomer> {
    // Best-effort update using external identifier search
    return this.createCustomer({ ...input, userId: input.userId });
  }

  async createOrder(input: CreateOrderInput): Promise<ERPNextOrder> {
    const payload = {
      naming_series: "ALG-ORD-.######",
      customer: input.userId,
      algovault_order_id: input.orderId,
      algovault_user_id: input.userId,
      stripe_payment_intent_id: input.stripePaymentIntentId,
      stripe_customer_id: input.stripeCustomerId,
      amount: input.amount,
      currency: input.currency || "USD",
      status: input.paymentStatus,
      delivery_status: input.paymentStatus === "paid" ? "Completed" : "Not Delivered",
    };
    try {
      const result = await this.post<{ data: { name: string; amount?: number } }>("/api/resource/AlgoVault Marketplace Order", payload);
      return {
        name: result.data.name,
        algovaultOrderId: input.orderId,
        algovaultUserId: input.userId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        stripeCustomerId: input.stripeCustomerId,
        customerName: input.userId,
        productName: input.productName,
        amount: result.data.amount ?? input.amount,
        currency: input.currency || "USD",
        status: input.paymentStatus,
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to create order ${input.orderId}`, "order", input.orderId);
    }
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ERPNextInvoice> {
    const payload = {
      customer: input.userId || input.customerName,
      algovault_order_id: input.orderId,
      amount: input.amount,
      currency: input.currency || "USD",
      status: input.status || "Draft",
    };
    try {
      const result = await this.post<{ data: { name: string; amount?: number } }>("/api/resource/AlgoVault Invoice", payload);
      return {
        name: result.data.name,
        customerName: input.userId || input.customerName,
        amount: result.data.amount ?? input.amount,
        currency: input.currency || "USD",
        status: input.status || "Draft",
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to create invoice`, "invoice", input.orderId || "unknown");
    }
  }

  async recordPayment(input: RecordPaymentInput): Promise<ERPNextPayment> {
    const payload = {
      reference_name: input.stripePaymentIntentId || `P-${Date.now()}`,
      amount: input.amount,
      currency: input.currency || "USD",
      mode_of_payment: input.modeOfPayment || "Stripe",
      status: input.status || "Paid",
    };
    try {
      const result = await this.post<{ data: { name: string; amount?: number } }>("/api/resource/AlgoVault Payment Record", payload);
      return {
        name: result.data.name,
        amount: result.data.amount ?? input.amount,
        currency: input.currency || "USD",
        modeOfPayment: input.modeOfPayment || "Stripe",
        status: input.status || "Paid",
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to record payment`, "payment", input.stripePaymentIntentId || "unknown");
    }
  }

  async createLicenseRecord(input: CreateLicenseInput): Promise<ERPNextLicense> {
    const payload = {
      naming_series: "ALG-LIC-.######",
      license_id: input.licenseId,
      algovault_user_id: input.userId,
      product_name: input.productName,
      order_id: input.orderId,
      start_date: input.startDate,
      expiry_date: input.expiryDate,
      status: input.status,
    };
    try {
      const result = await this.post<{ data: { name: string } }>("/api/resource/AlgoVault Bot License", payload);
      return {
        name: result.data.name,
        licenseId: input.licenseId,
        algovaultUserId: input.userId,
        productName: input.productName,
        orderId: input.orderId,
        startDate: input.startDate,
        expiryDate: input.expiryDate,
        status: input.status,
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to create license ${input.licenseId}`, "license", input.licenseId);
    }
  }

  async createCommission(input: CreateCommissionInput): Promise<ERPNextCommission> {
    const payload = {
      naming_series: "ALG-COM-.######",
      developer_id: input.developerId,
      affiliate_id: input.affiliateId,
      amount: input.amount,
      currency: input.currency || "USD",
      status: input.status || "Pending",
    };
    try {
      const result = await this.post<{ data: { name: string; amount?: number } }>("/api/resource/AlgoVault Commission", payload);
      return {
        name: result.data.name,
        amount: result.data.amount ?? input.amount,
        currency: input.currency || "USD",
        status: input.status || "Pending",
      };
    } catch (e) {
      throw new ERPNextSyncError(`Failed to create commission`, "commission", input.commissionId || "unknown");
    }
  }
}
