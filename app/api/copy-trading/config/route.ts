import { NextRequest, NextResponse } from "next/server";
import { authenticate, requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { isCopyTradingEnabled, resolveMasterEligibility } from "@/lib/copy-trading";

export const runtime = "nodejs";

type ConfigBody = {
    configId?: string;
    userId?: string;
    masterId?: string;
    masterMt5Account?: string | number;
    followerMt5Account?: string | number;
    licenseKey?: string;
    lotMultiplier?: number;
    maxLot?: number;
    maxOpenTrades?: number;
    reverseSignals?: boolean;
    copyStopLoss?: boolean;
    copyTakeProfit?: boolean;
    isActive?: boolean;
};

function parseConfig(body: ConfigBody) {
    const lotMultiplier = Number(body.lotMultiplier ?? 1);
    const maxLot = Number(body.maxLot ?? 0.1);
    const maxOpenTrades = Number(body.maxOpenTrades ?? 5);

    return {
        masterId: String(body.masterId || "").trim(),
        masterMt5Account: String(body.masterMt5Account || "").trim(),
        followerMt5Account: String(body.followerMt5Account || "").trim(),
        licenseKey: body.licenseKey ? String(body.licenseKey).trim() : undefined,
        lotMultiplier: Number.isFinite(lotMultiplier) && lotMultiplier > 0 ? lotMultiplier : 1,
        maxLot: Number.isFinite(maxLot) && maxLot > 0 ? maxLot : 0.1,
        maxOpenTrades: Number.isFinite(maxOpenTrades) && maxOpenTrades > 0 ? Math.floor(maxOpenTrades) : 5,
        reverseSignals: Boolean(body.reverseSignals),
        copyStopLoss: body.copyStopLoss !== false,
        copyTakeProfit: body.copyTakeProfit !== false,
        isActive: body.isActive !== false,
    };
}

function isOnline(account: Record<string, unknown>) {
    return Boolean(account.lastHeartbeatAt && Date.now() - Number(account.lastHeartbeatAt) < 120_000);
}

async function assertCanFollow(uid: string) {
    if (!(await isCopyTradingEnabled())) {
        return "Copy trading is disabled platform-wide.";
    }

    const userSnap = await adminDatabase.ref(`users/${uid}/copyTradingOverride`).get();
    const override = userSnap.val() || {};
    if (override.isFollowingDisabled === true) {
        return "Your account is currently restricted from following master traders.";
    }

    return "";
}

async function assertValidMaster(uid: string, cfg: ReturnType<typeof parseConfig>, configId?: string) {
    const masterSnap = await adminDatabase.ref(`live_accounts/${cfg.masterId}`).get();
    if (!masterSnap.exists()) {
        return "Master account not found.";
    }

    const master = masterSnap.val() || {};
    const eligibility = await resolveMasterEligibility(cfg.masterId, master.ownerUid || master.userId || null);

    if (!eligibility.allowCopyTrading || !eligibility.allowBeCopied || eligibility.isBeingCopiedDisabled) {
        return "This master is not accepting copy trading followers.";
    }

    if (!eligibility.allowBeFollowed || !eligibility.canBeListed) {
        return "This master is hidden from copy trading discovery.";
    }

    if (!isOnline(master)) {
        return "This master is offline. Try again after the master EA reconnects.";
    }

    if (String(master.mt5Account || "") === String(cfg.followerMt5Account || "")) {
        return "Follower account cannot be the same MT5 account as the master.";
    }

    const existingSnap = await adminDatabase.ref(`copy_trading/${uid}`).get();
    const existing = existingSnap.val() || {};
    for (const [id, raw] of Object.entries(existing as Record<string, Record<string, unknown>>)) {
        if (configId && id === configId) continue;
        if (
            String(raw.masterId || "") === cfg.masterId &&
            String(raw.followerMt5Account || "") === cfg.followerMt5Account
        ) {
            return "This follower account is already connected to that master.";
        }
    }

    return "";
}

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const enabled = await isCopyTradingEnabled();
    const userId = new URL(request.url).searchParams.get("userId");
    const admin = await requireAdmin(request);

    if (userId && admin) {
        const snap = await adminDatabase.ref(`copy_trading/${userId}`).get();
        return NextResponse.json({ enabled, configs: snap.val() || {} });
    }

    const snap = await adminDatabase.ref(`copy_trading/${token.uid}`).get();
    return NextResponse.json({ enabled, configs: snap.val() || {} });
}

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!(await isCopyTradingEnabled())) {
        return NextResponse.json({ error: "Copy trading is disabled platform-wide." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as ConfigBody;
    const cfg = parseConfig(body);

    if (!cfg.masterId || !cfg.followerMt5Account) {
        return NextResponse.json({ error: "masterId and followerMt5Account are required." }, { status: 400 });
    }

    const followError = await assertCanFollow(token.uid);
    if (followError) {
        return NextResponse.json({ error: followError }, { status: 403 });
    }

    const masterError = await assertValidMaster(token.uid, cfg);
    if (masterError) {
        return NextResponse.json({ error: masterError }, { status: 403 });
    }

    const configId = `${cfg.masterId}_${Date.now()}`;
    const now = Date.now();
    const record = {
        ...cfg,
        createdAt: now,
        updatedAt: now,
        totalCopied: 0,
        totalProfit: 0,
    };

    await adminDatabase.ref(`copy_trading/${token.uid}/${configId}`).set(record);

    return NextResponse.json({ success: true, configId, config: record });
}

export async function PATCH(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as ConfigBody;
    const configId = String(body.configId || "").trim();
    const targetUserId = body.userId && (await requireAdmin(request)) ? String(body.userId) : token.uid;

    if (!configId) {
        return NextResponse.json({ error: "configId is required." }, { status: 400 });
    }

    const ref = adminDatabase.ref(`copy_trading/${targetUserId}/${configId}`);
    const existing = (await ref.get()).val();
    if (!existing) {
        return NextResponse.json({ error: "Configuration not found." }, { status: 404 });
    }

    const cfg = parseConfig({ ...existing, ...body });
    if (cfg.isActive) {
        const followError = await assertCanFollow(targetUserId);
        if (followError) {
            return NextResponse.json({ error: followError }, { status: 403 });
        }

        const masterError = await assertValidMaster(targetUserId, cfg, configId);
        if (masterError) {
            return NextResponse.json({ error: masterError }, { status: 403 });
        }
    }

    await ref.update({
        ...cfg,
        updatedAt: Date.now(),
    });

    return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as ConfigBody;
    const configId = String(body.configId || "").trim();
    const targetUserId = body.userId && (await requireAdmin(request)) ? String(body.userId) : token.uid;

    if (!configId) {
        return NextResponse.json({ error: "configId is required." }, { status: 400 });
    }

    await adminDatabase.ref(`copy_trading/${targetUserId}/${configId}`).remove();
    return NextResponse.json({ success: true });
}
