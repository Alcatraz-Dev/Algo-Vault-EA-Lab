/**
 * Runtime self-check for the capability audit.
 *
 * Deliberately in its own module: the audit registry is imported by client
 * components (to filter Pro claims), while these imports pull the quantitative
 * implementations. Keeping them apart keeps the validation maths out of the
 * public tool-page bundle. Tests and server diagnostics import this file only.
 */

import { kellyResult, simulateRuin } from "@/lib/quant/risk-of-ruin";
import { cscvPbo } from "@/lib/quant/validation/pbo";
import { deflatedSharpeRatio } from "@/lib/quant/validation/dsr";
import { purgedKFold } from "@/lib/quant/validation/purged-cv";

/**
 * Prove the capabilities marked IMPLEMENTED actually execute on synthetic
 * input — compile-time presence is not evidence of a working feature.
 */
export function verifyImplementedCapabilities(): Array<{ id: string; ok: boolean; detail: string }> {
    const results: Array<{ id: string; ok: boolean; detail: string }> = [];

    try {
        const kelly = kellyResult({ winRate: 0.55, riskReward: 1.5, accountSize: 10_000 });
        results.push({ id: "kelly", ok: !!kelly && kelly.kellyFraction > 0, detail: JSON.stringify(kelly) });

        const ruin = simulateRuin({ winRate: 0.55, riskReward: 1.5, riskPerTradePct: 2, ruinDrawdownPct: 25, paths: 200, tradesPerPath: 200, seed: 7 });
        results.push({ id: "mc-ruin", ok: !!ruin && ruin.paths === 200 && ruin.ruinProbability >= 0, detail: `ruin=${ruin?.ruinProbability}` });

        const pbo = cscvPbo({
            returnsByConfig: Array.from({ length: 4 }, (_, n) => Array.from({ length: 64 }, (_, t) => Math.sin(t / (n + 2)) * 0.01 + 0.001)),
            blocks: 8,
        });
        results.push({ id: "pbo-cscv", ok: pbo.available, detail: pbo.available ? `pbo=${pbo.pbo}` : pbo.reason });

        const dsr = deflatedSharpeRatio({ returns: [0.01, -0.002, 0.004, 0.006, -0.001, 0.003], trials: 1 });
        results.push({ id: "deflated-sharpe", ok: dsr.available, detail: dsr.available ? `dsr=${dsr.dsr}` : dsr.reason });

        const cv = purgedKFold(100, 4, { labelSpan: 3, embargoSamples: 2 });
        results.push({ id: "purged-cv", ok: cv.available, detail: cv.available ? `folds=${cv.folds.length}` : cv.reason });
    } catch (error) {
        results.push({ id: "runtime", ok: false, detail: String(error) });
    }

    return results;
}
