/**
 * AlgoVault SDK Utilities
 */

import { AlgoVaultError, AlgoVaultAuthError, AlgoVaultRateLimitError } from "../errors";

export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(headerValue);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function buildUrl(baseUrl: string, path: string, params?: Record<string, any>): string {
  const urlPath = path.startsWith("http") ? path : `${baseUrl}${path}`;
  try {
    const url = new URL(urlPath, baseUrl && !urlPath.startsWith("http") ? undefined : (baseUrl && baseUrl.startsWith("http") ? baseUrl : undefined));
    // Better approach: if it's a relative path, construct properly
    if (!urlPath.startsWith("http")) {
      const fullUrl = new URL(path, baseUrl || "http://localhost");
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            fullUrl.searchParams.append(key, String(value));
          }
        });
      }
      return fullUrl.pathname + fullUrl.search;
    }
    const urlObj = new URL(urlPath);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.append(key, String(value));
        }
      });
    }
    return urlObj.toString();
  } catch {
    // Fallback
    let result = urlPath;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          qs.append(key, String(value));
        }
      });
      result += (result.includes('?') ? '&' : '?') + qs.toString();
    }
    return result;
  }
}

export async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403) {
    let message = "Authentication failed";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    throw new AlgoVaultAuthError(message);
  }

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    let message = "Rate limit exceeded";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    throw new AlgoVaultRateLimitError(message, retryAfter);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let details;
    try {
      const data = await response.json();
      message = data.error || data.message || message;
      details = data;
    } catch {}
    throw new AlgoVaultError(message, response.status, undefined, details);
  }

  try {
    return await response.json() as T;
  } catch (error) {
    throw new AlgoVaultError("Failed to parse response");
  }
}

export function shouldRetry(status: number, method: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}
