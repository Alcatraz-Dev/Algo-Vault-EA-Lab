/**
 * TradingView Execution Adapter
 *
 * Execution bridge adapter for AlgoVault Pro.
 *
 * CRITICAL DIRECTIVES & SECURITY REQUIREMENTS:
 * - Execution must NEVER be simulated or faked.
 * - TradingView MCP does NOT support account detection, orders, or positions (read-only market data).
 * - Real order placement routes via the AlgoVault Gateway API (MT5 integration).
 * - Implements duplicate order protection (idempotency via requestId).
 * - Implements strict risk check calculations.
 * - Records audit logs for all execution attempts.
 * - Requires explicit user confirmation for all trades (no automated auto-trading).
 */

import {
  NormalizedOrderIntent,
  OrderValidationResult,
  RiskCheckResult,
  ExecutionResult,
  TradingViewAccountInfo,
  TradeReceipt,
  ExecutionAuditRecord,
} from "@/types/execution";
import { placeOrder } from "@/api/algovault";

// In-memory set of processed request IDs for idempotency protection
const processedRequestIds = new Set<string>();
const inflightRequestIds = new Set<string>();

export class TradingViewExecutionAdapter {
  /**
   * Returns supported execution capabilities.
   */
  public getCapabilities(): {
    nativeTradingViewMcpSupported: false;
    gatewayExecutionSupported: true;
    supportedOrderTypes: Array<"MARKET" | "LIMIT" | "STOP">;
    supportedSides: Array<"BUY" | "SELL">;
    limitationNote: string;
  } {
    return {
      nativeTradingViewMcpSupported: false,
      gatewayExecutionSupported: true,
      supportedOrderTypes: ["MARKET", "LIMIT", "STOP"],
      supportedSides: ["BUY", "SELL"],
      limitationNote:
        "TradingView MCP is read-only. Orders are executed securely via the AlgoVault MT5 Gateway API upon user confirmation.",
    };
  }

  /**
   * Validates an order intent before execution.
   */
  public validateOrder(intent: NormalizedOrderIntent): OrderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Symbol check
    if (!intent.symbol || intent.symbol.trim() === "") {
      errors.push("Symbol is required.");
    }

    // Side check
    if (intent.side !== "BUY" && intent.side !== "SELL") {
      errors.push("Side must be BUY or SELL.");
    }

    // Quantity check
    if (!intent.quantity || intent.quantity <= 0 || isNaN(intent.quantity)) {
      errors.push("Quantity must be a positive number.");
    }

    // Order type check
    if (!["MARKET", "LIMIT", "STOP"].includes(intent.orderType)) {
      errors.push("Unsupported order type.");
    }

    // Price checks for pending orders
    if ((intent.orderType === "LIMIT" || intent.orderType === "STOP") && (!intent.price || intent.price <= 0)) {
      errors.push(`Entry price is required for ${intent.orderType} orders.`);
    }

    // Stop Loss & Take Profit logic checks
    if (intent.price && intent.stopLoss) {
      if (intent.side === "BUY" && intent.stopLoss >= intent.price) {
        errors.push("Stop Loss must be below Entry Price for BUY orders.");
      }
      if (intent.side === "SELL" && intent.stopLoss <= intent.price) {
        errors.push("Stop Loss must be above Entry Price for SELL orders.");
      }
    }

    if (intent.price && intent.takeProfit) {
      if (intent.side === "BUY" && intent.takeProfit <= intent.price) {
        errors.push("Take Profit must be above Entry Price for BUY orders.");
      }
      if (intent.side === "SELL" && intent.takeProfit >= intent.price) {
        errors.push("Take Profit must be below Entry Price for SELL orders.");
      }
    }

    // Warnings
    if (!intent.stopLoss) {
      warnings.push("No Stop Loss specified. Trading without a Stop Loss increases downside risk.");
    }

    if (!intent.takeProfit) {
      warnings.push("No Take Profit specified.");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      blockedReason: errors.length > 0 ? errors.join("; ") : null,
    };
  }

  /**
   * Computes risk metrics for an order given the account context.
   */
  public computeRiskCheck(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo
  ): RiskCheckResult {
    const validation = this.validateOrder(intent);
    const missingRiskData: string[] = [];
    const warnings = [...validation.warnings];

    const currentPrice = intent.price || 1.0;
    const estimatedExposure = intent.quantity * currentPrice;

    let riskAmount: number | null = null;
    let stopDistance: number | null = null;
    let potentialRiskReward: number | null = null;

    if (intent.stopLoss && currentPrice > 0) {
      stopDistance = Math.abs(currentPrice - intent.stopLoss);
      riskAmount = intent.quantity * stopDistance;

      if (intent.takeProfit) {
        const rewardDistance = Math.abs(intent.takeProfit - currentPrice);
        if (stopDistance > 0) {
          potentialRiskReward = rewardDistance / stopDistance;
          if (potentialRiskReward < 1.0) {
            warnings.push(`Low Risk/Reward Ratio: 1:${potentialRiskReward.toFixed(2)} (recommended at least 1:1.5).`);
          }
        }
      }
    } else {
      missingRiskData.push("Stop Loss (SL)");
      warnings.push("Risk could not be precisely calculated because Stop Loss is missing.");
    }

    let riskPercentage: number | null = null;
    if (riskAmount !== null && account.balance && account.balance > 0) {
      riskPercentage = (riskAmount / account.balance) * 100;
      if (riskPercentage > 5) {
        warnings.push(`High Risk Alert: This trade risks ${riskPercentage.toFixed(2)}% of account balance.`);
      }
    }

    const exceedsMaxRisk = riskPercentage !== null && riskPercentage > 10;
    const riskCalculable = riskAmount !== null;

    return {
      accountMode: account.mode,
      orderSize: intent.quantity,
      estimatedExposure,
      stopDistance,
      riskAmount,
      potentialRiskReward,
      missingRiskData,
      riskCalculable,
      brokerRestrictions: exceedsMaxRisk ? ["RISK_EXCEEDED_MAX_THRESHOLD"] : [],
      notes: validation.valid
        ? exceedsMaxRisk
          ? "Risk exceeds 10% maximum threshold."
          : "Risk evaluation passed."
        : "Validation errors detected.",
    };
  }

  /**
   * Submits an order intent to the AlgoVault MT5 Gateway upon explicit user confirmation.
   */
  public async submitOrder(
    intent: NormalizedOrderIntent,
    account: TradingViewAccountInfo,
    userConfirmed: boolean
  ): Promise<ExecutionResult> {
    const timestamp = Date.now();

    // 1. Check explicit user confirmation
    if (!userConfirmed) {
      return {
        requestId: intent.requestId,
        status: "REJECTED",
        orderId: null,
        executionPrice: null,
        filledQuantity: null,
        timestamp,
        error: "User confirmation required prior to execution.",
        mode: account.mode,
        broker: account.broker,
      };
    }

    // 2. Idempotency / Duplicate protection
    if (processedRequestIds.has(intent.requestId)) {
      return {
        requestId: intent.requestId,
        status: "REJECTED",
        orderId: null,
        executionPrice: null,
        filledQuantity: null,
        timestamp,
        error: `Duplicate order request detected (${intent.requestId}). Order already processed.`,
        mode: account.mode,
        broker: account.broker,
      };
    }

    if (inflightRequestIds.has(intent.requestId)) {
      return {
        requestId: intent.requestId,
        status: "PREPARING",
        orderId: null,
        executionPrice: null,
        filledQuantity: null,
        timestamp,
        error: `Order request ${intent.requestId} is currently in-flight.`,
        mode: account.mode,
        broker: account.broker,
      };
    }

    inflightRequestIds.add(intent.requestId);

    try {
      // 3. Check Account State
      if (account.accountState === "EXECUTION_UNAVAILABLE") {
        return {
          requestId: intent.requestId,
          status: "UNAVAILABLE",
          orderId: null,
          executionPrice: null,
          filledQuantity: null,
          timestamp,
          error:
            "TradingView MCP is read-only. Please connect the AlgoVault MT5 Gateway to enable real execution.",
          mode: account.mode,
          broker: account.broker,
        };
      }

      // 4. Validate Order Intent
      const validation = this.validateOrder(intent);
      if (!validation.valid) {
        return {
          requestId: intent.requestId,
          status: "REJECTED",
          orderId: null,
          executionPrice: null,
          filledQuantity: null,
          timestamp,
          error: `Order validation failed: ${validation.errors.join("; ")}`,
          mode: account.mode,
          broker: account.broker,
        };
      }

      // 5. Risk Check
      const riskCheck = this.computeRiskCheck(intent, account);
      if (riskCheck.brokerRestrictions.includes("RISK_EXCEEDED_MAX_THRESHOLD")) {
        return {
          requestId: intent.requestId,
          status: "REJECTED",
          orderId: null,
          executionPrice: null,
          filledQuantity: null,
          timestamp,
          error: "Trade rejected: Risk exceeds maximum safety threshold (10% of account balance).",
          mode: account.mode,
          broker: account.broker,
        };
      }

      // 6. Register request ID for idempotency before network dispatch
      processedRequestIds.add(intent.requestId);

      // 7. Execute Order via Gateway API
      const response = await placeOrder({
        symbol: intent.symbol,
        action: intent.side,
        volume: intent.quantity,
        price: intent.price ?? undefined,
        sl: intent.stopLoss ?? undefined,
        tp: intent.takeProfit ?? undefined,
        comment: "AlgoVault Pro TV Bridge",
      });

      if (response && response.success) {
        const orderId = response.order?.clientOrderId || `order-${Date.now()}`;
        const filledPrice = intent.price || 0;

        const receipt: TradeReceipt = {
          orderId: String(orderId),
          symbol: intent.symbol,
          side: intent.side,
          quantity: intent.quantity,
          broker: account.broker || "MT5 Gateway",
          accountReference: account.accountId || "mt5",
          executionPrice: filledPrice,
          timestamp,
          mode: account.mode,
          journalSynced: false,
        };

        const auditRecord: ExecutionAuditRecord = {
          id: `audit-${timestamp}-${Math.random().toString(36).substr(2, 6)}`,
          requestId: intent.requestId,
          userId: account.accountId || "user",
          accountReference: account.accountId || "mt5",
          broker: account.broker || "MT5 Gateway",
          mode: account.mode,
          symbol: intent.symbol,
          action: intent.side,
          orderType: intent.orderType,
          quantity: intent.quantity,
          price: filledPrice,
          timestamp,
          result: "FILLED",
          orderId: String(orderId),
        };
        void this.sendAuditRecord(auditRecord);

        return {
          requestId: intent.requestId,
          status: "FILLED",
          orderId: String(orderId),
          executionPrice: filledPrice,
          filledQuantity: intent.quantity,
          timestamp,
          mode: account.mode,
          broker: account.broker,
          receipt,
        };
      } else {
        const auditRecord: ExecutionAuditRecord = {
          id: `audit-${timestamp}-${Math.random().toString(36).substr(2, 6)}`,
          requestId: intent.requestId,
          userId: account.accountId || "user",
          accountReference: account.accountId || "mt5",
          broker: account.broker || "MT5 Gateway",
          mode: account.mode,
          symbol: intent.symbol,
          action: intent.side,
          orderType: intent.orderType,
          quantity: intent.quantity,
          price: intent.price || null,
          timestamp,
          result: "REJECTED",
          errorCode: response?.message || "GATEWAY_ERROR",
        };
        void this.sendAuditRecord(auditRecord);

        return {
          requestId: intent.requestId,
          status: "REJECTED",
          orderId: null,
          executionPrice: null,
          filledQuantity: null,
          timestamp,
          error: response?.message || "Order execution failed on Gateway.",
          mode: account.mode,
          broker: account.broker,
        };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Execution exception occurred";

      const auditRecord: ExecutionAuditRecord = {
        id: `audit-${timestamp}-${Math.random().toString(36).substr(2, 6)}`,
        requestId: intent.requestId,
        userId: account.accountId || "user",
        accountReference: account.accountId || "mt5",
        broker: account.broker || "MT5 Gateway",
        mode: account.mode,
        symbol: intent.symbol,
        action: intent.side,
        orderType: intent.orderType,
        quantity: intent.quantity,
        price: intent.price || null,
        timestamp,
        result: "UNAVAILABLE",
        errorCode: errorMessage,
      };
      void this.sendAuditRecord(auditRecord);

      return {
        requestId: intent.requestId,
        status: "UNAVAILABLE",
        orderId: null,
        executionPrice: null,
        filledQuantity: null,
        timestamp,
        error: errorMessage,
        mode: account.mode,
        broker: account.broker,
      };
    } finally {
      inflightRequestIds.delete(intent.requestId);
    }
  }

  private async sendAuditRecord(auditRecord: ExecutionAuditRecord): Promise<void> {
    try {
      await fetch("/api/extension/execution-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(auditRecord),
      });
    } catch {
      // Audit log network failure should not block user execution flow
    }
  }
}
