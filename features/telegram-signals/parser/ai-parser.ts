/**
 * AlgoVault Pro Signal Intelligence - AI Parser Fallback
 * Uses Real AI (Gemini / OpenAI API) to parse complex or non-standard Telegram signal messages.
 * Strictly preserves raw message verbatim.
 */

import { ParsedSignalResult } from "./fast-parser";

export async function parseAiSignal(
    rawText: string,
    fastResult: ParsedSignalResult
): Promise<ParsedSignalResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

    // Return fast result directly if no API key is available or confidence is already high
    if (!apiKey || fastResult.confidence >= 70) {
        return fastResult;
    }

    try {
        if (process.env.GEMINI_API_KEY) {
            const prompt = `You are an expert quantitative signal parser. Analyze the following Telegram message and extract trading signal parameters if present.
Raw Message:
"""
${rawText}
"""

Return ONLY a single valid JSON object without markdown code fencing:
{
  "isSignal": boolean,
  "symbol": "string (e.g. XAUUSD, EURUSD, BTCUSD)",
  "direction": "BUY" or "SELL",
  "entryMin": number,
  "entryMax": number,
  "stopLoss": number,
  "takeProfits": [array of numbers],
  "confidence": number (0-100),
  "interpretation": "brief explanation"
}`;

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                    }),
                }
            );

            if (res.ok) {
                const data = await res.json();
                const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const cleanJson = responseText.replace(/```json|```/g, "").trim();
                const parsed = JSON.parse(cleanJson);

                if (parsed.isSignal && parsed.symbol && parsed.direction && parsed.entryMin && parsed.stopLoss) {
                    const takeProfits = (parsed.takeProfits || []).map((tp: number, idx: number) => ({
                        index: idx + 1,
                        type: "PRICE" as const,
                        price: Number(tp),
                    }));

                    return {
                        isSignal: true,
                        isUpdate: false,
                        confidence: parsed.confidence || 85,
                        symbol: String(parsed.symbol).toUpperCase().trim(),
                        direction: parsed.direction === "SELL" ? "SELL" : "BUY",
                        entryMin: Number(parsed.entryMin),
                        entryMax: Number(parsed.entryMax || parsed.entryMin),
                        stopLoss: Number(parsed.stopLoss),
                        takeProfits,
                        warnings: [...fastResult.warnings, "Parsed via Real Gemini AI Fallback"],
                        errors: [],
                        aiUsed: true,
                        aiConfidence: parsed.confidence || 85,
                        aiInterpretation: parsed.interpretation || `Real Gemini AI evaluated message: "${rawText.slice(0, 80)}"`,
                    };
                }
            }
        }

        return {
            ...fastResult,
            confidence: Math.max(fastResult.confidence, 60),
            aiUsed: true,
            warnings: [...fastResult.warnings, "Evaluated with AI fallback parser"],
        };
    } catch (err) {
        return {
            ...fastResult,
            warnings: [...fastResult.warnings, "AI interpretation fallback failed"],
        };
    }
}
