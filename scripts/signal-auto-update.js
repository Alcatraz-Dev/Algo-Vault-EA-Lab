#!/usr/bin/env node

/**
 * Signal Auto-Update Scheduler
 * 
 * This script runs periodically to check active signals and update their status
 * based on current market prices (SL/TP hits, entry triggers, etc.)
 * 
 * Usage: 
 * - Run manually: node scripts/signal-auto-update.js
 * - Schedule via cron: */5 * * * * /path/to/node /path/to/scripts/signal-auto-update.js
 * - Or deploy as a Vercel Cron Job
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function callAutoUpdate(endpoint: string, body: any) {
    try {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        console.log(`[${new Date().toISOString()}] ${endpoint}:`, data);
        return data;
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error calling ${endpoint}:`, err);
        return null;
    }
}

async function main() {
    console.log(`[${new Date().toISOString()}] Starting signal auto-update check...`);

    // Check regular AI signals
    await callAutoUpdate("/api/signals/auto-update", { checkAllActive: true });

    // Check Pro signals
    await callAutoUpdate("/api/pro-signals/auto-update", { checkAllActive: true });

    console.log(`[${new Date().toISOString()}] Signal auto-update check completed.`);
}

main().catch(console.error);