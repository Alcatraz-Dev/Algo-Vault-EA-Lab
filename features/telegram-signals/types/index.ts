/**
 * AlgoVault Pro Signal Intelligence - Type Definitions
 */

export type SignalStyle = "SCALPING" | "INTRADAY" | "SWING" | "UNKNOWN";

export type SignalTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1" | "UNKNOWN";

export type SignalDirection = "BUY" | "SELL";

export type EntryType = "MARKET" | "LIMIT" | "STOP";

export type TakeProfitType = "PRICE" | "OPEN";

export interface TakeProfitTarget {
    index: number;
    type: TakeProfitType;
    price: number | null;
    hit?: boolean;
    hitAt?: number;
    excursionPips?: number;
}

export type SignalStatus =
    | "CREATED"
    | "PENDING_ENTRY"
    | "ENTRY_TRIGGERED"
    | "TP1_HIT"
    | "BE_PROFIT_LOCK"
    | "TP2_HIT"
    | "TP3_HIT"
    | "TP4_HIT"
    | "TP5_OPEN_RUNNER"
    | "CLOSED"
    | "STOPPED"
    | "EXPIRED"
    | "CANCELLED"
    | "NEEDS_REVIEW"
    | "INVALID";

export interface SignalEvent {
    id: string;
    signalId: string;
    type: string;
    timestamp: number;
    price?: number | null;
    metadata?: Record<string, any>;
}

export interface LatencyMetadata {
    receivedAt: number;
    parsedAt: number;
    normalizedAt: number;
    storedAt?: number;
    notificationStartedAt?: number;
    notificationCompletedAt?: number;
    executionStartedAt?: number;
    executionCompletedAt?: number;
}

export interface ParserMetadata {
    fastParsed: boolean;
    confidence: number;
    warnings: string[];
    errors: string[];
    aiUsed: boolean;
    aiConfidence?: number;
    aiInterpretation?: string;
    aiWarnings?: string[];
    detectedLanguage?: string;
}

export interface SourceMetadata {
    sourceId: string;
    sourceType: "telegram_channel" | "telegram_bot" | "custom_webhook";
    channelName?: string;
    channelId?: string;
    messageId?: string | number;
    replyToMessageId?: string | number;
    channelQuality?: "A" | "B" | "C" | number;
}

export interface ProSignal {
    id: string;
    fingerprint: string;
    symbol: string;
    direction: SignalDirection;
    entryType: EntryType;
    entry: number; // Midpoint entry price
    entryMin: number;
    entryMax: number;
    stopLoss: number;
    takeProfits: TakeProfitTarget[];
    openTarget: boolean; // Flag indicating open runner target
    style: SignalStyle;
    timeframe: SignalTimeframe;
    createdAt: number;
    receivedAt: number;
    expirationAt: number;
    status: SignalStatus;
    sourceMetadata: SourceMetadata;
    parserMetadata: ParserMetadata;
    latency: LatencyMetadata;
    rawMessageId: string;
    events: SignalEvent[];
    lastUpdateAt: number;
    sourceGroupId?: string;
    strategyId?: string;
    followCount?: number;
}

export interface TelegramSource {
    id: string;
    name: string;
    channelId: string;
    username?: string;
    type?: "channel" | "supergroup" | "group" | "private" | "other";
    membersCount?: number;
    enabled: boolean;
    parsingEnabled: boolean;
    groupId: string;
    channelQuality?: "A" | "B" | "C" | number;
    connectionStatus: "connected" | "disconnected" | "error" | "reconnecting";
    style: SignalStyle;
    defaultTimeframe: SignalTimeframe;
    expirationMinutes?: number;
    autoExecution: boolean;
    notificationEnabled: boolean;
    riskRuleId?: string;
    lastReceivedAt?: number;
    lastError?: string;
    signalCount?: number;
    createdAt: number;
    updatedAt: number;
}

export interface SourceGroup {
    id: string;
    name: string; // e.g. "Premium / Strong", "Standard / Medium", "Testing / Experimental", "Blocked"
    description?: string;
    enabled: boolean;
    autoExecution: boolean;
    riskMultiplier: number;
    expirationMinutes: number;
    notificationEnabled: boolean;
    createdAt: number;
}

export interface TelegramAdminConfig {
    connected: boolean;
    userAccount?: {
        id: string;
        username?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
    };
    connectionStatus: "connected" | "disconnected" | "authenticating" | "awaiting_code" | "awaiting_qr" | "awaiting_2fa" | "error";
    lastConnectedAt?: number;
    lastError?: string;
    monitoringActive?: boolean;
    monitoringStartedAt?: number;
    lastMessageAt?: number;
    phoneCodeHash?: string;
    tempPhoneNumber?: string;
}

export interface TelegramChannelEntity {
    id: string;
    title: string;
    username?: string;
    type: "channel" | "supergroup" | "group" | "private" | "other";
    participantsCount?: number;
    lastMessage?: string;
    lastMessageAt?: number;
    isMonitored: boolean;
    monitoredSourceId?: string;
}

export interface TelegramLogEntry {
    id: string;
    timestamp: number;
    level: "info" | "warning" | "error" | "success";
    message: string;
    details?: string;
}

export interface TelegramConnectionTestResult {
    timestamp: number;
    success: boolean;
    checks: {
        telegramAuth: { passed: boolean; message: string };
        sessionValidity: { passed: boolean; message: string };
        channelAccess: { passed: boolean; message: string };
        messageRetrieval: { passed: boolean; message: string };
        parserAvailability: { passed: boolean; message: string };
        signalNormalization: { passed: boolean; message: string };
        firebaseWrite: { passed: boolean; message: string };
        notificationPipeline: { passed: boolean; message: string };
    };
    logs: string[];
}


export interface RawTelegramMessage {
    id: string;
    sourceId: string;
    telegramMessageId: string | number;
    rawText: string;
    receivedAt: number;
    telegramTimestamp: number;
    replyToMessageId?: string | number;
    parsedSignalId?: string;
    processingStatus: "pending" | "parsed" | "ignored" | "error";
    error?: string;
}

export interface NotificationDelivery {
    id: string;
    eventId: string;
    signalId: string;
    userId: string;
    destination: "in_app" | "telegram_bot" | "discord";
    status: "PENDING" | "SENT" | "FAILED" | "RETRYING";
    attempts: number;
    createdAt: number;
    sentAt?: number;
    error?: string;
}

export interface SignalConflictSummary {
    symbol: string;
    buyCount: number;
    sellCount: number;
    signals: Array<{
        id: string;
        direction: SignalDirection;
        entryMin: number;
        entryMax: number;
        style: SignalStyle;
        createdAt: number;
    }>;
}

export interface RiskConfig {
    enabled: boolean;
    riskPercent: number; // e.g. 1.0 (1%)
    fixedLot?: number; // e.g. 0.10
    maxDailyLossPercent: number; // e.g. 5.0 (5%)
    maxOpenPositions: number; // e.g. 3
    maxSymbolExposureLots: number; // e.g. 2.0
    maxSignalsPerSourceDaily: number; // e.g. 10
    cooldownSeconds: number; // e.g. 60
    allowMarketEntries: boolean;
    requireStopLoss: boolean;
}

export interface UserProSignalSettings {
    notificationsEnabled: boolean;
    destinations: {
        inApp: boolean;
        telegramBot: boolean;
        discord: boolean;
    };
    eventSubscriptions: {
        NEW_SIGNAL: boolean;
        SIGNAL_UPDATED: boolean;
        ENTRY_TRIGGERED: boolean;
        TP1_HIT: boolean;
        TP2_HIT: boolean;
        TP3_HIT: boolean;
        TP4_HIT: boolean;
        TP5_HIT: boolean;
        SL_HIT: boolean;
        BREAKEVEN: boolean;
        SIGNAL_EXPIRED: boolean;
        SIGNAL_CANCELLED: boolean;
    };
    autoExecution: RiskConfig;
}

export interface SignalAnalyticsSegment {
    sourceId?: string;
    groupId?: string;
    style?: SignalStyle;
    timeframe?: SignalTimeframe;
    symbol?: string;
    session?: "ASIA" | "LONDON" | "NEW_YORK" | "OVERLAP";
    totalSignals: number;
    wins: number;
    losses: number;
    expired: number;
    cancelled: number;
    winRate: number;
    tp1HitRate: number;
    tp2HitRate: number;
    tp3HitRate: number;
    tp4HitRate: number;
    tp5RunnerRate: number;
    avgDurationMinutes: number;
    avgRiskReward: number;
    sampleSize: number;
    lowSampleSizeWarning: boolean;
}
