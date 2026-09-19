/**
 * AlgoVault Pro Signal Intelligence - Multilingual Dictionary & Text Normalizer
 * Supports English, Swedish, French, German, Spanish, Italian, Portuguese, Arabic, Dutch, Turkish, Russian.
 */

export interface NormalizedMessageText {
    cleanText: string;
    detectedLanguage: string;
}

// Language Keyword Mapping Dictionary
export const MULTILINGUAL_DICTIONARY = {
    BUY: [
        "BUY", "LONG",
        "KÖP", "KÖPA", // Swedish
        "ACHAT", "ACHETER", // French
        "KAUF", "KAUFEN", // German
        "COMPRA", "COMPRAR", // Spanish / Portuguese / Italian
        "ACQUISTO", // Italian
        "شراء", // Arabic
        "KOOP", "KOPEN", // Dutch
        "AL", "ALIM", // Turkish
        "ПОКУПКА", "КУПИТЬ", // Russian
        "🟢", "⬆️"
    ],
    SELL: [
        "SELL", "SHORT",
        "SÄLJ", "SÄLJA", // Swedish
        "VENTE", "VENDRE", // French
        "VERKAUF", "VERKAUFEN", // German
        "VENTA", "VENDER", // Spanish / Portuguese
        "VENDITA", "VENDERE", // Italian
        "بيع", // Arabic
        "VERKOOP", "VERKOPEN", // Dutch
        "SAT", "SATIM", // Turkish
        "ПРОДАЖА", "ПРОДАТЬ", // Russian
        "🔴", "⬇️"
    ],
    ENTRY: [
        "ENTRY", "ENTRIES", "ENTRY ZONE", "BUY NOW", "SELL NOW", "ENTRY AT",
        "INTRÄDE", "ENTRÉ", // Swedish
        "ENTRÉE", "ENTREE", // French
        "EINSTIEG", "EINSTIEGSPREIS", // German
        "ENTRADA", "ZONA DE ENTRADA", // Spanish / Portuguese
        "INGRESSO", "ZONA INGRESSO", // Italian
        "سعر الدخول", "الدخول", // Arabic
        "INGANG", // Dutch
        "GIRIŞ", "GIRIS", // Turkish
        "ВХОД", "ТОЧКА ВХОДА" // Russian
    ],
    STOP_LOSS: [
        "SL", "STOP LOSS", "STOPLOSS", "STOP-LOSS", "STOP",
        "STOPP", "STOPP LOSS", // Swedish / German
        "STOP-PERTE", // French
        "PARADA DE PÉRDIDA", // Spanish
        "STOP LOSS", // Italian / Portuguese
        "وقف الخسارة", "وقف", // Arabic
        "ZARAR KES", // Turkish
        "СТОП ЛОСС", "СТОП" // Russian
    ],
    TAKE_PROFIT: [
        "TP", "TP1", "TP2", "TP3", "TP4", "TP5", "TAKE PROFIT", "TARGET", "TARGET 1", "TARGET 2",
        "VINSTMÅL", "MÅL", // Swedish
        "OBJECTIF", "PRENDRE PROFIT", // French
        "ZIEL", "GEWINNZIEL", // German
        "OBJETIVO", "TOMA DE GANANCIAS", // Spanish / Portuguese
        "OBIETTIVO", "TARGET DI PROFITTO", // Italian
        "هدف", "أهداف", "أخذ الربح", // Arabic
        "DOEL", // Dutch
        "HEDEF", "KAR AL", // Turkish
        "ТАРГЕТ", "ПРОФИТ", "ТЕЙК ПРОФИТ" // Russian
    ],
    OPEN_TARGET: [
        "OPEN", "OPENED", "OPEN TARGET", "RUNNER", "LET RUN", "FREE", "∞", "UNLIMITED",
        "ÖPPEN", "ÖPPET", // Swedish
        "OUVERT", // French
        "OFFEN", // German
        "ABIERTO", // Spanish / Portuguese
        "APERTO", // Italian
        "مفتوح", "مفتوحة", // Arabic
        "OPEN", // Dutch
        "AÇIK", "ACIK", // Turkish
        "ОТКРЫТЫЙ", "ОТКРЫТО" // Russian
    ]
};

/**
 * Normalizes decorative emojis, whitespace, dashes, and punctuation.
 */
export function normalizeMessageText(rawText: string): NormalizedMessageText {
    if (!rawText) return { cleanText: "", detectedLanguage: "en" };

    // 1. Convert Unicode dashes & separators to standard hyphen (-)
    let text = rawText
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
        .replace(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width spaces
        .replace(/\t/g, " ");

    // 2. Strip decorative emojis while preserving direction indicators (🟢, 🔴, ⬆️, ⬇️, ∞)
    text = text.replace(
        /[^\x00-\x7F\u0600-\u06FF\u0400-\u04FF🟢🔴⬆️⬇️∞åäöÅÄÖéèêàâùûüÿçßáéíóúñÁÉÍÓÚÑ]/gi,
        " "
    );

    // 3. Normalize multiple whitespace
    text = text.replace(/ {2,}/g, " ").trim();

    // 4. Heuristic Language Detection
    let detectedLanguage = "en";
    if (/\b(öppen|öppet|sälj|köp)\b/i.test(text)) detectedLanguage = "sv";
    else if (/\b(vente|achat|ouvert)\b/i.test(text)) detectedLanguage = "fr";
    else if (/\b(verkaufen|kauf|offen)\b/i.test(text)) detectedLanguage = "de";
    else if (/\b(venta|compra|abierto)\b/i.test(text)) detectedLanguage = "es";
    else if (/\b(vendita|acquisto|aperto)\b/i.test(text)) detectedLanguage = "it";
    else if (/[\u0600-\u06FF]/.test(text)) detectedLanguage = "ar";
    else if (/[\u0400-\u04FF]/.test(text)) detectedLanguage = "ru";

    return { cleanText: text, detectedLanguage };
}

/**
 * Checks if a word or text matches any keyword list in the multilingual dictionary
 */
export function matchMultilingualKeyword(
    text: string,
    category: keyof typeof MULTILINGUAL_DICTIONARY
): boolean {
    const keywords = MULTILINGUAL_DICTIONARY[category];
    for (const kw of keywords) {
        if (kw.length === 1 || /[^\x00-\x7F]/.test(kw)) {
            // Non-ASCII characters (Arabic, Swedish, Russian) or single emoji indicators
            if (text.toLowerCase().includes(kw.toLowerCase())) return true;
        } else {
            const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
            if (regex.test(text)) return true;
        }
    }
    return false;
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
