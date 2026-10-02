/**
 * AlgoVault extension install identity — runs on the WEBSITE (algovault.dev).
 *
 * The free daily-signal quota for the Chrome extension is enforced on the
 * AlgoVault server, keyed by a random install id. To make that quota survive
 * extension removal/reinstall, the id must live somewhere deleting the
 * extension does NOT touch:
 *
 *   1. the website's localStorage (origin-scoped, survives extension removal,
 *      and is exactly what the extension cannot store for itself), and
 *   2. chrome.storage.sync, mirrored here through the externally_connectable
 *      bridge so the id also rides the Chrome profile across machines.
 *
 * The id is minted ONCE per browser on the first site visit and then simply
 * re-announced. The extension reads it on startup and sends it with every
 * daily-signals request.
 */
"use client";

import { useEffect } from "react";

const LS_KEY = "algovaultExtInstallId";
const SYNC_KEY = "algovaultExtInstallId";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function getOrCreateSiteId(): string {
  try {
    const existing = localStorage.getItem(LS_KEY);
    if (existing && ID_PATTERN.test(existing)) return existing;
  } catch { /* storage may be unavailable (private mode) */ }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id =
    Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20) +
    Date.now().toString(36);
  try {
    localStorage.setItem(LS_KEY, id);
  } catch { /* ignore */ }
  return id;
}

function mirrorToChromeStorage(id: string): void {
  const w = window as unknown as {
    chrome?: {
      runtime?: {
        sendMessage?: (extId: string, msg: unknown, cb?: (res: unknown) => void) => void;
        lastError?: { message?: string } | null;
      };
    };
  };
  const chromeRuntime = w.chrome?.runtime;
  const extId = process.env.NEXT_PUBLIC_EXTENSION_ID;
  if (!chromeRuntime?.sendMessage || !extId) return;
  try {
    chromeRuntime.sendMessage(extId, { type: "STORE_INSTALL_ID", installId: id }, () => {
      void chromeRuntime.lastError; // extension not installed yet — fine, site copy is authoritative
    });
  } catch { /* extension absent */ }
}

/** Reads the binding back from the extension (used to heal a wiped site id). */
function healFromExtension(): void {
  const w = window as unknown as {
    chrome?: {
      runtime?: {
        sendMessage?: (extId: string, msg: unknown, cb?: (res: unknown) => void) => void;
        lastError?: { message?: string } | null;
      };
    };
  };
  const chromeRuntime = w.chrome?.runtime;
  const extId = process.env.NEXT_PUBLIC_EXTENSION_ID;
  if (!chromeRuntime?.sendMessage || !extId) return;
  try {
    chromeRuntime.sendMessage(extId, { type: "GET_INSTALL_ID" }, (res) => {
      const healed = (res as { installId?: string } | undefined)?.installId;
      if (healed && ID_PATTERN.test(healed)) {
        try { localStorage.setItem(LS_KEY, healed); } catch { /* ignore */ }
      }
      void chromeRuntime.lastError;
    });
  } catch { /* extension absent */ }
}

export default function ExtensionInstallBinding() {
  useEffect(() => {
    const id = getOrCreateSiteId();
    mirrorToChromeStorage(id);
    // If the site storage was cleared but the extension still holds the id
    // (storage.sync), restore it instead of minting a second identity.
    healFromExtension();
  }, []);

  return null;
}
