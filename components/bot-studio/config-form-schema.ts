import { z } from "zod";

export const primitiveXauUsdScalpingConfigSchema = z.object({
    timeframe: z.literal("M1"),
    direction: z.union([z.literal("long"), z.literal("short")]),
    tp1Pips: z.number().int().min(1).max(200),
    tp2Pips: z.number().int().min(1).max(400),
    slPips: z.number().int().min(1).max(400),
    riskPercent: z.number().min(0.1).max(10),
    maxPositions: z.number().int().min(1).max(10),
    warmUpCandles: z.number().int().min(0).max(500),
    maxSpreadPoints: z.number().int().min(0).max(100),
    magicNumber: z.number().int().min(1).max(999999),
    enabled: z.boolean(),
});

export type PrimitiveXauUsdScalpingConfig = z.infer<
    typeof primitiveXauUsdScalpingConfigSchema
>;
