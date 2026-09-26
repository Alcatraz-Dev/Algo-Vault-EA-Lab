export interface ERPNextCustomer {
  name: string;
  algovaultUserId: string;
  email?: string;
  country?: string;
  customerGroup?: string;
  status?: string;
  externalId?: string;
}

export interface ERPNextOrder {
  name: string;
  algovaultOrderId: string;
  algovaultUserId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  customerName?: string;
  productName?: string;
  amount: number;
  currency?: string;
  status: string; // paid | pending | refunded | cancelled
  deliveryStatus?: string;
  externalIds?: Record<string, string>;
}

export interface ERPNextInvoice {
  name?: string;
  customerName?: string;
  algovaultUserId?: string;
  algovaultOrderId?: string;
  amount: number;
  currency?: string;
  status?: string;
  externalIds?: Record<string, string>;
}

export interface ERPNextPayment {
  name?: string;
  customerName?: string;
  algovaultOrderId?: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency?: string;
  modeOfPayment?: string;
  status?: string;
  externalIds?: Record<string, string>;
}

export interface ERPNextLicense {
  name?: string;
  licenseId: string;
  algovaultUserId: string;
  productName?: string;
  orderId?: string;
  startDate: string; // ISO
  expiryDate?: string; // ISO
  status: string; // active | expired | revoked
  externalIds?: Record<string, string>;
}

export interface ERPNextCommission {
  name?: string;
  algovaultCommissionId?: string;
  developerId?: string;
  affiliateId?: string;
  amount: number;
  currency?: string;
  status: string;
  externalIds?: Record<string, string>;
}

export interface ERPNextSubscription {
  name?: string;
  subscriptionId: string;
  algovaultUserId: string;
  productName?: string;
  status: string; // active | cancelled | expired
  startDate: string;
  currentPeriodEnd?: string;
  externalIds?: Record<string, string>;
}

export interface CreateCustomerInput {
  userId: string;
  email?: string;
  name?: string;
  country?: string;
  externalIds?: Record<string, string>;
}

export interface UpdateCustomerInput {
  userId: string;
  email?: string;
  country?: string;
  name?: string;
  externalIds?: Record<string, string>;
}

export interface CreateOrderInput {
  orderId: string;
  userId: string;
  productId?: string;
  productName?: string;
  amount: number;
  currency?: string;
  paymentStatus: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  developerId?: string;
  externalIds?: Record<string, string>;
}

export interface CreateInvoiceInput {
  orderId?: string;
  userId?: string;
  amount: number;
  currency?: string;
  customerName?: string;
  status?: string;
  externalIds?: Record<string, string>;
}

export interface RecordPaymentInput {
  orderId?: string;
  userId?: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency?: string;
  modeOfPayment?: string;
  status?: string;
  externalIds?: Record<string, string>;
}

export interface CreateLicenseInput {
  licenseId: string;
  userId: string;
  productName?: string;
  orderId?: string;
  startDate: string;
  expiryDate?: string;
  status: string;
  externalIds?: Record<string, string>;
}

export interface CreateCommissionInput {
  commissionId?: string;
  amount: number;
  currency?: string;
  developerId?: string;
  affiliateId?: string;
  status?: string;
  externalIds?: Record<string, string>;
}
