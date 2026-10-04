/** Minimal chrome API stub so extension services can render outside Chrome. */
const chromeStub = {
  storage: {
    local: {
      get: (_key: string, cb?: (res: Record<string, unknown>) => void) => cb?.({}),
      set: (_payload: Record<string, unknown>, cb?: () => void) => cb?.(),
      remove: (_key: string, cb?: () => void) => cb?.(),
    },
    sync: {
      get: (_key: string, cb?: (res: Record<string, unknown>) => void) => cb?.({}),
      set: (_payload: Record<string, unknown>, cb?: () => void) => cb?.(),
    },
  },
  runtime: {
    sendMessage: () => undefined,
    onMessage: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
    getURL: (path: string) => path,
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

export {};
