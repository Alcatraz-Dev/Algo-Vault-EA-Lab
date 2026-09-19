/**
 * AlgoVault Pro Signal Intelligence - Signal Engine
 * Orchestrates raw message preservation, parsing, normalization, RTDB storage,
 * lifecycle updating, notification delivery, and MT5 gateway dispatch.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { parseFastSignal } from "../parser/fast-parser";
import { parseAiSignal } from "../parser/ai-parser";
import { normalizeAndValidateSignal } from "../normalizer/signal-normalizer";
import { transitionSignalState } from "../lifecycle/state-machine";
import { dispatchSignalNotification, broadcastSignalNotificationToProUsers } from "../notifications/notification-engine";
import { validateSignalRisk } from "../risk/risk-engine";
import { dispatchProSignalToGateway } from "../gateway/gateway-adapter";
import { sanitizeForFirebase } from "../utils/firebase";
import type {
    ProSignal,
    RawTelegramMessage,
    SourceMetadata,
    UserProSignalSettings,
} from "../types";

export interface IngestTelegramMessageInput {
    userId: string;
    rawText: string;
    sourceMetadata: SourceMetadata;
    telegramTimestamp?: number;
    userSettings?: UserProSignalSettings;
    broadcast?: boolean;
}

export async function processIncomingTelegramMessage(
    input: IngestTelegramMessageInput
): Promise<{
    success: boolean;
    rawMessageId: string;
    signal?: ProSignal;
    isUpdate?: boolean;
    error?: string;
}> {
    const { userId, rawText, sourceMetadata, userSettings, broadcast } = input;
    const receivedAt = Date.now();
    const rawMessageId = `msg_${receivedAt}_${Math.random().toString(36).substring(2, 7)}`;

    try {
        // 1. RAW MESSAGE PRESERVATION (§7) - Always preserve raw message verbatim
        const rawMessage: RawTelegramMessage = {
            id: rawMessageId,
            sourceId: sourceMetadata.sourceId,
            telegramMessageId: sourceMetadata.messageId || rawMessageId,
            rawText,
            receivedAt,
            telegramTimestamp: input.telegramTimestamp || receivedAt,
            ...(sourceMetadata.replyToMessageId !== undefined
                ? { replyToMessageId: sourceMetadata.replyToMessageId }
                : {}),
            processingStatus: "pending",
        };

        const cleanRawMessage = sanitizeForFirebase(rawMessage);

        await adminDatabase
            .ref(`telegramMessages/${userId}/${rawMessageId}`)
            .set(cleanRawMessage);

        // 2. FAST PARSING (§5, §8)
        const parsedAt = Date.now();
        let parsedResult = parseFastSignal(rawText);

        // 3. AI FALLBACK (§39) if ambiguous
        if (!parsedResult.isSignal && !parsedResult.isUpdate && parsedResult.confidence < 70) {
            parsedResult = await parseAiSignal(rawText, parsedResult);
        }

        // 4. HANDLE FOLLOW-UP SIGNAL UPDATES (§16)
        if (parsedResult.isUpdate) {
            await adminDatabase
                .ref(`telegramMessages/${userId}/${rawMessageId}`)
                .update({ processingStatus: "parsed" });

            // Find active matching signal to update
            const activeSignal = await findActiveMatchingSignal(userId, sourceMetadata, parsedResult);
            if (activeSignal) {
                const eventType = mapUpdateToEventType(parsedResult.updateType!);
                const transition = transitionSignalState(activeSignal, eventType, {
                    newStopLoss: parsedResult.updateMetadata?.newStopLoss,
                    tpIndex: parsedResult.updateMetadata?.tpHitIndex,
                });

                if (transition.transitioned) {
                    await saveProSignal(userId, transition.updatedSignal);
                    if (transition.newEvent) {
                        if (broadcast || userId === "system" || userId === "global") {
                            await broadcastSignalNotificationToProUsers(transition.updatedSignal, transition.newEvent);
                        } else {
                            await dispatchSignalNotification({
                                userId,
                                signal: transition.updatedSignal,
                                event: transition.newEvent,
                                userSettings,
                            });
                        }
                    }
                }

                return {
                    success: true,
                    rawMessageId,
                    signal: transition.updatedSignal,
                    isUpdate: true,
                };
            }

            return { success: true, rawMessageId, isUpdate: true };
        }

        if (!parsedResult.isSignal) {
            await adminDatabase
                .ref(`telegramMessages/${userId}/${rawMessageId}`)
                .update({ processingStatus: "ignored", error: "Message does not contain a signal" });

            return {
                success: false,
                rawMessageId,
                error: "Message parsed as non-signal",
            };
        }

        // 5. NORMALIZE & VALIDATE SIGNAL (§11, §40)
        const normalizedSignal = normalizeAndValidateSignal({
            rawMessageId,
            rawText,
            sourceMetadata,
            parsed: parsedResult,
            receivedAt,
            parsedAt,
        });

        // 6. PERSIST PRO SIGNAL IN FIREBASE RTDB (§37)
        await saveProSignal(userId, normalizedSignal);

        await adminDatabase
            .ref(`telegramMessages/${userId}/${rawMessageId}`)
            .update({ processingStatus: "parsed", parsedSignalId: normalizedSignal.id });

        // 7. DISPATCH REALTIME NOTIFICATIONS (§25, §26)
        if (normalizedSignal.events.length > 0) {
            if (broadcast || userId === "system" || userId === "global") {
                await broadcastSignalNotificationToProUsers(normalizedSignal, normalizedSignal.events[0]);
            } else {
                await dispatchSignalNotification({
                    userId,
                    signal: normalizedSignal,
                    event: normalizedSignal.events[0],
                    userSettings,
                });
            }
        }

        // 8. OPTIONAL MT5 AUTO-EXECUTION (§33, §34)
        if (userSettings?.autoExecution?.enabled) {
            const riskCheck = validateSignalRisk(normalizedSignal, userSettings.autoExecution);
            if (riskCheck.valid) {
                const mt5Account = "default";
                await dispatchProSignalToGateway({
                    userId,
                    signal: normalizedSignal,
                    mt5Account,
                    volume: riskCheck.calculatedLot || 0.01,
                });
            }
        }

        return {
            success: true,
            rawMessageId,
            signal: normalizedSignal,
            isUpdate: false,
        };
    } catch (err) {
        console.error("[processIncomingTelegramMessage]", err);
        const errMsg = err instanceof Error ? err.message : "Ingestion failed";

        await adminDatabase
            .ref(`telegramMessages/${userId}/${rawMessageId}`)
            .update({ processingStatus: "error", error: errMsg });

        return {
            success: false,
            rawMessageId,
            error: errMsg,
        };
    }
}

export async function saveProSignal(userId: string, signal: ProSignal): Promise<void> {
    const cleanSignal = sanitizeForFirebase(signal);
    const signalRef = adminDatabase.ref(`telegramSignals/${userId}/${cleanSignal.id}`);
    await signalRef.set(cleanSignal);
}

export async function getProSignals(userId: string): Promise<ProSignal[]> {
    const snap = await adminDatabase.ref(`telegramSignals/${userId}`).get();
    if (!snap.exists()) return [];

    const data = snap.val();
    return Object.values(data) as ProSignal[];
}

export async function deleteProSignal(userId: string, signalId: string): Promise<void> {
    await adminDatabase.ref(`telegramSignals/${userId}/${signalId}`).remove();
}

export async function clearProSignals(userId: string): Promise<void> {
    await adminDatabase.ref(`telegramSignals/${userId}`).remove();
}

async function findActiveMatchingSignal(
    userId: string,
    sourceMetadata: SourceMetadata,
    parsedUpdate: any
): Promise<ProSignal | null> {
    const signals = await getProSignals(userId);
    const active = signals.filter(
        (s) => !["CLOSED", "STOPPED", "EXPIRED", "CANCELLED"].includes(s.status)
    );

    if (active.length === 0) return null;

    // First match by replyToMessageId if available
    if (sourceMetadata.replyToMessageId) {
        const replyMatch = active.find(
            (s) => String(s.sourceMetadata.messageId) === String(sourceMetadata.replyToMessageId)
        );
        if (replyMatch) return replyMatch;
    }

    // Match by symbol if specified in update or pick most recent active signal
    if (parsedUpdate.updateMetadata?.symbol) {
        const symbolMatch = active.find(
            (s) => s.symbol.toUpperCase() === parsedUpdate.updateMetadata.symbol.toUpperCase()
        );
        if (symbolMatch) return symbolMatch;
    }

    // Fallback: return most recently created active signal
    active.sort((a, b) => b.createdAt - a.createdAt);
    return active[0];
}

function mapUpdateToEventType(updateType: string): any {
    switch (updateType) {
        case "MOVE_BE":
            return "MOVE_BE";
        case "SL_MOVE":
            return "MOVE_SL";
        case "TP_HIT":
            return "HIT_TP";
        case "CLOSE_SIGNAL":
            return "CLOSE_SIGNAL";
        default:
            return "CLOSE_SIGNAL";
    }
}
