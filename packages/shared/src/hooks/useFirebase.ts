import { useEffect, useState, useCallback } from "react";
import { authMethods, dbMethods, DB_PATHS } from "./config";
import type { User } from "firebase/auth";
import type { TradingAccount, UserBot, AISignal, Alert, Notification, RiskMetrics } from "../types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = authMethods.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, loading };
}

export function useTradingAccounts(uid?: string) {
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = dbMethods.subscribe<Record<string, TradingAccount>>(
      DB_PATHS.tradingAccounts(uid),
      (data) => {
        if (data) {
          setAccounts(Object.values(data));
        } else {
          setAccounts([]);
        }
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [uid]);

  return { accounts, loading, error };
}

export function useUserBots(uid?: string) {
  const [bots, setBots] = useState<UserBot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setBots([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = dbMethods.subscribe<Record<string, UserBot>>(
      DB_PATHS.userBots(uid),
      (data) => {
        if (data) {
          setBots(Object.values(data));
        } else {
          setBots([]);
        }
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [uid]);

  return { bots, loading };
}

export function useAISignals(filters?: { tier?: "FREE" | "PRO"; status?: "active" | "closed"; limit?: number }) {
  const [signals, setSignals] = useState<AISignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // For React Native, we'll use the API client instead of direct RTDB
    // This is a placeholder - actual implementation uses apiClient.getSignals()
    setSignals([]);
    setLoading(false);
  }, [filters]);

  return { signals, loading };
}

export function useAlerts(uid?: string, options?: { unreadOnly?: boolean; limit?: number }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setAlerts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let queryConstraints;
    if (options?.unreadOnly) {
      queryConstraints = dbMethods.query.equalTo(DB_PATHS.alerts(uid), "read", false);
    } else {
      queryConstraints = dbMethods.query.limitToLast(DB_PATHS.alerts(uid), options?.limit || 50);
    }

    const unsubscribe = dbMethods.subscribe<Record<string, Alert>>(
      DB_PATHS.alerts(uid),
      (data) => {
        if (data) {
          let result = Object.values(data);
          if (options?.unreadOnly) {
            result = result.filter((a) => !a.read);
          }
          result.sort((a, b) => b.createdAt - a.createdAt);
          if (options?.limit) {
            result = result.slice(0, options.limit);
          }
          setAlerts(result);
        } else {
          setAlerts([]);
        }
        setLoading(false);
      },
      { queryConstraints }
    );

    return unsubscribe;
  }, [uid, options?.unreadOnly, options?.limit]);

  return { alerts, loading };
}

export function useNotifications(uid?: string, options?: { unreadOnly?: boolean; limit?: number }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = dbMethods.subscribe<Record<string, Notification>>(
      DB_PATHS.notifications(uid),
      (data) => {
        if (data) {
          let result = Object.values(data);
          if (options?.unreadOnly) {
            result = result.filter((n) => !n.read);
          }
          result.sort((a, b) => b.createdAt - a.createdAt);
          if (options?.limit) {
            result = result.slice(0, options.limit);
          }
          setNotifications(result);
        } else {
          setNotifications([]);
        }
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [uid, options?.unreadOnly, options?.limit]);

  return { notifications, loading };
}

export function useRiskMetrics(accountId?: string) {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setMetrics(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = dbMethods.subscribe<RiskMetrics>(
      DB_PATHS.riskMetrics(accountId),
      (data) => {
        setMetrics(data);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [accountId]);

  return { metrics, loading };
}

// Real-time subscription hook for any path
export function useRealtime<T>(path: string, queryConstraints?: ReturnType<typeof dbMethods.query.byChild>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = dbMethods.subscribe<T>(
      path,
      (value) => {
        setData(value);
        setLoading(false);
      },
      { queryConstraints }
    );

    return unsubscribe;
  }, [path, queryConstraints]);

  return { data, loading };
}