export function getAlgoVaultUrl(): string {
  const envUrl = typeof import.meta !== "undefined" && (import.meta.env as Record<string, string>)?.VITE_ALGOVAULT_URL;
  if (envUrl) return envUrl;
  return "http://localhost:3000";
}

export function isDevelopment(): boolean {
  return getAlgoVaultUrl().includes("localhost");
}
