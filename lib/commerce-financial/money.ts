/**
 * Canonical money representation using integer minor units.
 * Never silent floating-point arithmetic for persisted values.
 */

import type { Money } from "./types";

export function minor(amount: number, currency: string): Money {
  return {
    amountMinor: Math.round(Number(amount) * 100),
    currency: String(currency || "usd").toUpperCase(),
  };
}

export function fromMinor(amountMinor: number, currency: string): number {
  return amountMinor / 100;
}

export function isValidCurrency(c: string): boolean {
  return /^[A-Z]{3}$/.test(String(c || ""));
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}
