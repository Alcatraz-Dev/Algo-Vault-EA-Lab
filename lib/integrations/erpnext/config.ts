export interface ERPNextConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
}

export function loadERPNextConfig(): ERPNextConfig {
  const enabledRaw = process.env.ERPNEXT_ENABLED ?? "false";
  const enabled = enabledRaw === "true" || enabledRaw === "1";
  return {
    enabled,
    baseUrl: process.env.ERPNEXT_BASE_URL ?? "",
    apiKey: process.env.ERPNEXT_API_KEY ?? "",
    apiSecret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

export function isERPNextConfigured(config: ERPNextConfig): boolean {
  return (
    config.enabled === true &&
    config.baseUrl.length > 0 &&
    config.apiKey.length > 0 &&
    config.apiSecret.length > 0
  );
}
