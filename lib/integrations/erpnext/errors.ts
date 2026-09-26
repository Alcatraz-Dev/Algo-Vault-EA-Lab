export class ERPNextIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string = "ERP_INTEGRATION_ERROR"
  ) {
    super(message);
    this.name = "ERPNextIntegrationError";
  }
}

export class ERPNextNotEnabledError extends ERPNextIntegrationError {
  constructor() {
    super("ERPNext integration is not enabled", "ERP_NOT_ENABLED");
    this.name = "ERPNextNotEnabledError";
  }
}

export class ERPNextNotReachableError extends ERPNextIntegrationError {
  constructor(url: string) {
    super(`ERPNext not reachable at ${url}`, "ERP_NOT_REACHABLE");
    this.name = "ERPNextNotReachableError";
  }
}

export class ERPNextAuthError extends ERPNextIntegrationError {
  constructor() {
    super("ERPNext authentication failed", "ERP_AUTH_ERROR");
    this.name = "ERPNextAuthError";
  }
}

export class ERPNextSyncError extends ERPNextIntegrationError {
  constructor(
    message: string,
    public readonly entityType?: string,
    public readonly entityId?: string
  ) {
    super(message, "ERP_SYNC_ERROR");
    this.name = "ERPNextSyncError";
  }
}
