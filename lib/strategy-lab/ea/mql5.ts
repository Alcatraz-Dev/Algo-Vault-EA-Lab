// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — MQL5 source builder.
//
// This module deterministically compiles an EAStrategySpec into a complete,
// real MQL5 Expert Advisor. The blueprint is a faithful, translation of the
// Strategy Lab backtest engine (lib/strategy-lab/backtest.ts + features.ts):
// the same features (EMA/ATR trend, confirmed swings, liquidity sweeps,
// BOS/CHOCH, Fair Value Gaps, order blocks, breakouts, momentum, sessions)
// computed per timeframe on CLOSED bars only (no look-ahead).
//
// No AI model ever produces executable MQL5 directly; this builder is the only
// place MQL5 text is created, from validated structured rules.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context consumed by the MQL5 builder. Every placeholder is filled from the
 * validated AST/spec so nothing in the output is hardcoded to a specific
 * instrument.
 */
export type MQL5BuildContext = {
    // Identity
    eaName: string;
    eaVersion: string; // e.g. "1.0.0"
    strategyName: string;
    strategyId: string;
    strategyVersion: string;
    strategyHash: string;
    generatorVersion: string;
    magicNumber: number;
    symbol: string;
    comment: string;
    // Timeframes
    setupTf: string; // "M5"
    usedTimeframes: string[]; // distinct keys incl. setup, sorted
    tfToEnum: Record<string, string>; // "M5" -> "PERIOD_M5"
    // Logic
    direction: "long" | "short";
    entryExpression: string;
    confirmationExpression: string | null;
    useRegime: boolean;
    regimes: string[];
    sessions: string[]; // allowed, may be []
    weekdaysBitmask: number; // 255 = all
    volMinAtrPct: number;
    volMaxAtrPct: number;
    maxTradesPerDay: number;
    cooldownCandles: number;
    maxSpreadPoints: number;
    // Risk
    riskMode: "percent" | "fixed_lot";
    riskPercent: number;
    fixedLot: number;
    maxPositions: number;
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
    maxSlippagePoints: number;
    // Exits
    slMode: "atr" | "level";
    slAtrMultiple: number;
    slLevelOffset: number;
    tpMode: "r" | "fixed";
    tpR1: number;
    tpR2: number;
    tpR3: number;
    tpFixedDistance: number;
    tpPartialR1Pct: number; // 0 if none
    tpPartialR2Pct: number;
    moveBeAfterTp1: boolean;
    lockAfterTp2: boolean;
    trailingEnabled: boolean;
    trailingStopAtr: number;
};

const FEATURE_STRUCT = `
//+------------------------------------------------------------------+
//| Per-timeframe feature state (mirrors CandleFeatures in the lab)   |
//+------------------------------------------------------------------+
struct FeatureState
{
   datetime barTime;        // open time of the last CLOSED bar
   double   close;
   double   ema20;
   double   ema50;
   double   atr;
   double   atrPct;
   string   trend;          // "bullish" | "bearish" | "neutral"
   string   volState;       // "low" | "normal" | "high" | "extreme"
   int      lastSweepBarsAgo; // -1 when no sweep in window
   string   lastSweepSide;  // "buy_side" | "sell_side" | "none"
   string   chochDirection; // "bullish" | "bearish" | ""
   string   bosDirection;   // "bullish" | "bearish" | ""
   bool     higherHigh, higherLow, lowerHigh, lowerLow;
   string   fvgDirection;   // "bullish" | "bearish" | ""
   int      fvgBarsAgo;     // -1 when none
   string   obDirection;    // "bullish" | "bearish" | ""
   double   momentumPct;
   bool     breakoutHigh;
   bool     breakoutLow;
   string   session;        // "asian" | "london" | "new_york" | "overlap" | "closed"
   int      weekdayUtc;     // 0=Sunday .. 6=Saturday
   bool     valid;
};
`;

const HELPERS = `
//+------------------------------------------------------------------+
//| String / math helpers                                             |
//+------------------------------------------------------------------+
// Comma-separated membership test ("a,b,c").
bool StrIn(string value, string list)
{
   if(StringLen(list) == 0) return(false);
   string parts[];
   int n = StringSplit(list, ',', parts);
   for(int i = 0; i < n; i++)
      if(parts[i] == value) return(true);
   return(false);
}

ENUM_TIMEFRAMES TFOf(string key)
{
   if(key == "M1")  return(PERIOD_M1);
   if(key == "M3")  return(PERIOD_M3);
   if(key == "M5")  return(PERIOD_M5);
   if(key == "M15") return(PERIOD_M15);
   if(key == "M30") return(PERIOD_M30);
   if(key == "H1")  return(PERIOD_H1);
   if(key == "H4")  return(PERIOD_H4);
   if(key == "D1")  return(PERIOD_D1);
   return(PERIOD_M5);
}

// UTC hour of a broker/server bar time (biquote data in the lab is UTC).
datetime ToUtc(datetime serverTime)
{
   return(serverTime + (TimeGMT() - TimeCurrent()));
}

// Session label from a UTC hour — identical thresholds to the lab's sessions.ts.
string SessionOf(datetime utcTime)
{
   int h = TimeHour(utcTime);
   if(h >= 12 && h < 16) return("overlap");
   if(h >= 7  && h < 16) return("london");
   if(h >= 12 && h < 21) return("new_york");
   if(h >= 0  && h < 8)  return("asian");
   return("closed");
}

// Recursive EMA over the LAST period values (same seed as the lab).
double EmaLast(double &closes[], int count, int period)
{
   if(count <= 0) return(0.0);
   int start = count - period;
   if(start < 0) start = 0;
   const double k = 2.0 / (period + 1);
   double result = closes[start];
   for(int i = start + 1; i < count; i++)
      result = closes[i] * k + result * (1.0 - k);
   return(result);
}

// Simple mean ATR over the last period true ranges.
double AtrLast(MqlRates &r[], int count, int period)
{
   if(count < 2) return(0.0);
   int n = MathMin(period, count - 1);
   double sum = 0.0;
   for(int i = count - n; i < count; i++)
   {
      double tr = r[i].high - r[i].low;
      double prevClose = r[i - 1].close;
      double tr2 = MathAbs(r[i].high - prevClose);
      double tr3 = MathAbs(r[i].low - prevClose);
      sum += MathMax(tr, MathMax(tr2, tr3));
   }
   return(sum / n);
}
`;

const FEATURE_ENGINE = `
//+------------------------------------------------------------------+
//| Feature computation for one timeframe                             |
//|                                                                   |
//| Recomputes the deterministic feature snapshot over the last 120   |
//| CLOSED bars using only data known at that bar's close — never     |
//| reads the currently-forming bar (no look-ahead).                   |
//+------------------------------------------------------------------+
void LoadFeatureState(FeatureState &fs, const ENUM_TIMEFRAMES tf)
{
   fs.valid = false;
   int totalBars = Bars(_Symbol, tf);
   if(totalBars < 14) return;

   int cnt = MathMin(totalBars, 120);
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, tf, 1, cnt, rates); // skip bar 0 (forming)
   if(copied < MathMin(14, cnt)) return;
   cnt = copied;

   // local chronological arrays
   double o[]; double h[]; double l[]; double c[]; datetime t[];
   ArrayResize(o, cnt); ArrayResize(h, cnt); ArrayResize(l, cnt);
   ArrayResize(c, cnt); ArrayResize(t, cnt);
   for(int i = 0; i < cnt; i++)
   {
      o[i] = rates[i].open;  h[i] = rates[i].high;
      l[i] = rates[i].low;   c[i] = rates[i].close;
      t[i] = rates[i].time;
   }

   // ---- EMA / ATR / trend / volatility --------------------------------
   double closes[]; ArrayResize(closes, cnt);
   for(int i = 0; i < cnt; i++) closes[i] = c[i];

   double ema20 = EmaLast(closes, cnt, 20);
   double ema50 = EmaLast(closes, cnt, 50);
   double atr   = AtrLast(rates, cnt, 14);

   double lastClose = c[cnt - 1];
   double atrPct = lastClose != 0.0 ? atr / lastClose * 100.0 : 0.0;

   string trend = "neutral";
   if(cnt >= 20)
   {
      if(ema20 > ema50 * 1.001) trend = "bullish";
      else if(ema20 < ema50 * 0.999) trend = "bearish";
   }

   string volState = "normal";
   if(atrPct < 0.1) volState = "low";
   else if(atrPct < 0.3) volState = "normal";
   else if(atrPct < 0.6) volState = "high";
   else volState = "extreme";

   // ---- Confirmed swings (3-bar confirmation, backdated) ---------------
   double swH[200]; int swHi[200]; int swHn = 0;
   double swL[200]; int swLi[200]; int swLn = 0;
   for(int i = 6; i < cnt; i++)
   {
      int peak = i - 3;
      bool isHigh = true;
      bool isLow  = true;
      for(int j = i - 6; j <= i; j++)
      {
         if(h[j] > h[peak]) isHigh = false;
         if(l[j] < l[peak]) isLow  = false;
      }
      if(isHigh) { if(swHn < 200) { swH[swHn] = h[peak]; swHi[swHn] = peak; swHn++; } }
      if(isLow)  { if(swLn < 200) { swL[swLn] = l[peak]; swLi[swLn] = peak; swLn++; } }
   }

   // ---- Per-bar event scan (sweeps / BOS / FVG / OB) --------------------
   int lastBar = cnt - 1;
   int sweepSide[120]; int sweepIdx[120];
   int bosDirAt[120];
   int fvgDirAt[120];
   int obDirAt[120];
   ArrayInitialize(sweepSide, 0); ArrayInitialize(sweepIdx, -1);
   ArrayInitialize(bosDirAt, 0);  ArrayInitialize(fvgDirAt, 0); ArrayInitialize(obDirAt, 0);

   for(int i = 6; i < cnt; i++)
   {
      // Sweep: break of a confirmed level + close back beyond it
      int bestSweepSide = 0;
      int bestSweepIdx  = -1;
      for(int s = 0; s < swLn; s++)
      {
         if(swLi[s] > i - 3) continue;         // only levels confirmed before this bar
         if(bestSweepSide == 0 && l[i] < swL[s] && c[i] > swL[s])
            { bestSweepSide = 1; bestSweepIdx = i; break; }   // buy-side sweep
         if(bestSweepSide == 0 && h[i] > swH[s] && c[i] < swH[s])
            { bestSweepSide = -1; bestSweepIdx = i; break; }  // sell-side sweep
      }
      sweepIdx[i] = bestSweepIdx;
      sweepSide[i] = bestSweepSide;

      // BOS from the progression of the two most recent confirmed swings
      if(swHn >= 2 && swH[swHn - 1] > swH[swHn - 2]) bosDirAt[i] = 1;
      else if(swLn >= 2 && swL[swLn - 1] < swL[swLn - 2]) bosDirAt[i] = -1;

      // FVG: candle[i-1] gap between candle[i-2] and candle[i]
      if(i >= 2)
      {
         if(l[i - 1] > h[i - 2]) fvgDirAt[i] = 1;       // bullish FVG
         else if(h[i - 1] < l[i - 2]) fvgDirAt[i] = -1; // bearish FVG
      }

      // Order block: strong body against the prior candle (1.5x)
      if(i >= 1)
      {
         double body   = MathAbs(c[i] - o[i]);
         double prevBody = MathAbs(c[i - 1] - o[i - 1]);
         if(c[i] > o[i] && c[i - 1] < o[i - 1] && body > prevBody * 1.5) obDirAt[i] = 1;
         else if(c[i] < o[i] && c[i - 1] > o[i - 1] && body > prevBody * 1.5) obDirAt[i] = -1;
      }
   }

   // ---- Latest occurrences within the rolling windows --------------------
   int lastSweepIndex = -1;
   int lastSweepSideInt = 0;
   int startSweep = MathMax(lastBar - 59, 0);
   for(int i = lastBar; i >= startSweep && lastSweepIndex < 0; i--)
   {
      if(sweepSide[i] != 0) { lastSweepIndex = i; lastSweepSideInt = sweepSide[i]; }
   }

   int lastBosDirection = 0;
   int startBos = MathMax(lastBar - 59, 0);
   for(int i = lastBar; i >= startBos && lastBosDirection == 0; i--)
   {
      if(bosDirAt[i] != 0) lastBosDirection = bosDirAt[i];
   }

   // CHOCH = a BOS against the prevailing direction (post-hoc, backdated)
   int chochDirection = 0;
   {
      int prevDir = 0;
      for(int i = 6; i < cnt; i++)
      {
         if(bosDirAt[i] == 0) continue;
         if(prevDir != 0 && bosDirAt[i] != prevDir) chochDirection = bosDirAt[i];
         prevDir = bosDirAt[i];
      }
      // override rule: most recent co-directional structure change wins
      int startChoch = MathMax(lastBar - 59, 0);
      int lastChoch = 0;
      int lastBosIdx = -1;
      for(int i = lastBar; i >= startChoch; i--)
      {
         if(bosDirAt[i] != 0 && lastBosIdx < 0) lastBosIdx = i;
      }
      // find the newest choch (direction flip) index if any
      int flipIdx = -1;
      {
         int pd = 0;
         for(int i = 6; i < cnt; i++)
         {
            if(bosDirAt[i] == 0) continue;
            if(pd != 0 && bosDirAt[i] != pd) { chochDirection = bosDirAt[i]; flipIdx = i; }
            pd = bosDirAt[i];
         }
      }
      if(chochDirection != 0 && lastBosIdx >= 0 && bosDirAt[lastBosIdx] == chochDirection)
      {
         // co-directional: the most recent BOS is the one that matters
      }
      (void)flipIdx; // reserved for future diagnostics
   }

   int lastFvgDirection = 0;
   int lastFvgIndex = -1;
   int startFvg = MathMax(lastBar - 7, 0);
   for(int i = lastBar; i >= startFvg && lastFvgIndex < 0; i--)
   {
      if(fvgDirAt[i] != 0) { lastFvgDirection = fvgDirAt[i]; lastFvgIndex = i; }
   }

   int lastObDirection = 0;
   int startOb = MathMax(lastBar - 19, 0);
   for(int i = lastBar; i >= startOb && lastObDirection == 0; i--)
   {
      if(obDirAt[i] != 0) lastObDirection = obDirAt[i];
   }

   // ---- Swing point trend labels (last two confirmed each side) -----------
   bool higherHigh = (swHn >= 2 && swH[swHn - 1] > swH[swHn - 2]);
   bool higherLow  = (swLn >= 2 && swL[swLn - 1] > swL[swLn - 2]);
   bool lowerHigh  = (swHn >= 2 && swH[swHn - 1] < swH[swHn - 2]);
   bool lowerLow   = (swLn >= 2 && swL[swLn - 1] < swL[swLn - 2]);

   // ---- Breakout + momentum -----------------------------------------------
   bool breakoutHigh = false;
   bool breakoutLow  = false;
   if(lastBar >= 10)
   {
      double maxHigh = h[0];
      double minLow  = l[0];
      for(int i = lastBar - 10; i < lastBar; i++)
      {
         if(h[i] > maxHigh) maxHigh = h[i];
         if(l[i] < minLow)  minLow  = l[i];
      }
      breakoutHigh = (c[lastBar] > maxHigh);
      breakoutLow  = (c[lastBar] < minLow);
   }
   double momentumPct = 0.0;
   if(lastBar >= 10)
   {
      double ref = c[lastBar - 10];
      if(ref != 0.0) momentumPct = (c[lastBar] - ref) / ref * 100.0;
   }

   // ---- Populate the state -------------------------------------------------
   fs.barTime = t[lastBar];
   fs.close = c[lastBar];
   fs.ema20 = ema20;
   fs.ema50 = ema50;
   fs.atr = atr;
   fs.atrPct = atrPct;
   fs.trend = trend;
   fs.volState = volState;
   fs.lastSweepBarsAgo = lastSweepIndex >= 0 ? lastBar - lastSweepIndex : -1;
   fs.lastSweepSide = lastSweepSideInt > 0 ? "buy_side" : (lastSweepSideInt < 0 ? "sell_side" : "none");
   fs.chochDirection = chochDirection > 0 ? "bullish" : (chochDirection < 0 ? "bearish" : "");
   fs.bosDirection = lastBosDirection > 0 ? "bullish" : (lastBosDirection < 0 ? "bearish" : "");
   fs.higherHigh = higherHigh;
   fs.higherLow = higherLow;
   fs.lowerHigh = lowerHigh;
   fs.lowerLow = lowerLow;
   fs.fvgDirection = lastFvgDirection > 0 ? "bullish" : (lastFvgDirection < 0 ? "bearish" : "");
   fs.fvgBarsAgo = lastFvgIndex >= 0 ? lastBar - lastFvgIndex : -1;
   fs.obDirection = lastObDirection > 0 ? "bullish" : (lastObDirection < 0 ? "bearish" : "");
   fs.momentumPct = momentumPct;
   fs.breakoutHigh = breakoutHigh;
   fs.breakoutLow = breakoutLow;
   datetime utcBar = ToUtc(t[lastBar]);
   fs.session = SessionOf(utcBar);
   fs.weekdayUtc = TimeDayOfWeek(utcBar);
   fs.valid = true;
}
`;

const REGIME_ENGINE = `
//+------------------------------------------------------------------+
//| Market regime detector (mirrors lib/analytics/detectRegime)      |
//|   • structure bias: last 5 BOS/CHOCH events (swing pts, 3-bar)   |
//|   • VWAP offset over the last 20 closed bars                     |
//|   • ATR% / 14-bar momentum / 20-bar range                        |
//+------------------------------------------------------------------+
string StructureBias(MqlRates &r[], int n)
{
   double sh[160]; int shI[160]; int shn = 0;
   double sl[160]; int slI[160]; int sln = 0;
   for(int i = 3; i < n - 3; i++)
   {
      bool isHigh = true;
      bool isLow  = true;
      for(int j = i - 3; j <= i + 3; j++)
      {
         if(r[j].high > r[i].high) isHigh = false;
         if(r[j].low  < r[i].low)  isLow  = false;
      }
      if(isHigh) { if(shn < 160) { sh[shn] = r[i].high; shI[shn] = i; shn++; } }
      if(isLow)  { if(sln < 160) { sl[sln] = r[i].low;  slI[sln] = i; sln++; } }
   }

   // BOS events (higher high -> bullish, lower low -> bearish), ordered by index
   int bosIdx[256]; int bosDir[256]; int bosn = 0;
   {
      double lastHh = -1.0;
      for(int i = 0; i < shn; i++)
      {
         if(lastHh >= 0.0 && sh[i] > lastHh && bosn < 256) { bosIdx[bosn] = shI[i]; bosDir[bosn] = 1; bosn++; }
         lastHh = sh[i];
      }
      double lastLl = -1.0;
      for(int i = 0; i < sln; i++)
      {
         if(lastLl >= 0.0 && sl[i] < lastLl && bosn < 256) { bosIdx[bosn] = slI[i]; bosDir[bosn] = -1; bosn++; }
         lastLl = sl[i];
      }
      // insertion sort by index (small n)
      for(int a = 1; a < bosn; a++)
      {
         int k = bosIdx[a]; int d = bosDir[a]; int b = a - 1;
         while(b >= 0 && bosIdx[b] > k) { bosIdx[b + 1] = bosIdx[b]; bosDir[b + 1] = bosDir[b]; b--; }
         bosIdx[b + 1] = k; bosDir[b + 1] = d;
      }
   }

   // CHOCH = direction flip between consecutive BOS events
   int evDir[256]; int evType[256]; int evn = 0;
   {
      int prev = 0;
      for(int i = 0; i < bosn; i++)
      {
         if(prev != 0 && bosDir[i] != prev) { if(evn < 256) { evDir[evn] = bosDir[i]; evType[evn] = 2; evn++; } }
         else if(evn < 256) { evDir[evn] = bosDir[i]; evType[evn] = 1; evn++; }
         prev = bosDir[i];
      }
   }

   int last5Bull = 0;
   int last5Bear = 0;
   int startEv = MathMax(0, evn - 5);
   for(int i = startEv; i < evn; i++)
   {
      if(evDir[i] > 0) last5Bull++; else last5Bear++;
   }
   if(last5Bull > last5Bear) return("bullish");
   if(last5Bear > last5Bull) return("bearish");
   return("neutral");
}

double VwapLast20(MqlRates &r[], int n)
{
   int start = MathMax(0, n - 20);
   double cumTp = 0.0;
   double cumVol = 0.0;
   for(int i = start; i < n; i++)
   {
      double tp = (r[i].high + r[i].low + r[i].close) / 3.0;
      double vol = r[i].tick_volume > 0 ? (double)r[i].tick_volume : 1.0;
      cumTp += tp * vol;
      cumVol += vol;
   }
   return(cumVol > 0.0 ? cumTp / cumVol : 0.0);
}

string DetectRegime(const ENUM_TIMEFRAMES tf)
{
   int total = Bars(_Symbol, tf);
   if(total < 21) return("transitional");
   int cnt = MathMin(total, 120);
   MqlRates r[];
   ArraySetAsSeries(r, false);
   if(CopyRates(_Symbol, tf, 1, cnt, r) < cnt) return("transitional");

   double bullishScore = 0.0;
   double bearishScore = 0.0;
   double rangeScore   = 0.0;

   string bias = StructureBias(r, cnt);
   if(bias == "bullish") bullishScore += 25;
   else if(bias == "bearish") bearishScore += 25;
   else rangeScore += 15;

   double vwap = VwapLast20(r, cnt);
   double lastClose = r[cnt - 1].close;
   double distPct = vwap != 0.0 ? (lastClose - vwap) / vwap * 100.0 : 0.0;
   if(distPct > 0.05) bullishScore += 15;
   else if(distPct < -0.05) bearishScore += 15;
   else rangeScore += 10;

   double atr = AtrLast(r, cnt, 14);
   double atrPercent = lastClose > 0.0 ? atr / lastClose * 100.0 : 0.0;

   double past = r[cnt - 1 - 14].close;
   double mom = past != 0.0 ? (lastClose - past) / past * 100.0 : 0.0;
   if(mom > 0.3) bullishScore += 20;
   else if(mom < -0.3) bearishScore += 20;
   else rangeScore += 10;

   if(bullishScore > bearishScore && bullishScore > rangeScore)
      return(atrPercent > 0.5 ? "breakout" : "trending_bullish");
   if(bearishScore > bullishScore && bearishScore > rangeScore)
      return(atrPercent > 0.5 ? "breakout" : "trending_bearish");
   if(rangeScore > bullishScore && rangeScore > bearishScore)
   {
      if(atrPercent > 0.5) return("high_volatility");
      if(atrPercent < 0.1) return("low_volatility");
      return("ranging");
   }
   return("transitional");
}
`;

const TRADE_MANAGEMENT = `
//+------------------------------------------------------------------+
//| Trade state registry                                              |
//|                                                                   |
//| MT5 positions carry no custom state, so per-ticket TradeState     |
//| entries track partial-TP hits / break-even / trailing activation. |
//| When a partial close re-issues the remaining volume under a new   |
//| ticket, the registry migrates the state by entry price + side.    |
//+------------------------------------------------------------------+
struct TradeState
{
   ulong   ticket;
   int     direction;      // +1 long, -1 short
   double  entry;
   double  sl;
   double  tp1;
   double  tp2;
   double  tp3;
   bool    tp1Hit;
   bool    tp2Hit;
   bool    trailingActive;
   bool    inUse;
};

TradeState g_states[64];

int FindStateSlot()
{
   for(int i = 0; i < 64; i++)
      if(!g_states[i].inUse) return(i);
   return(-1);
}

int StateIndexByTicket(ulong ticket)
{
   for(int i = 0; i < 64; i++)
      if(g_states[i].inUse && g_states[i].ticket == ticket) return(i);
   return(-1);
}

int CountManagedPositions()
{
   int count = 0;
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC)   == (long)MagicNumber &&
         PositionGetString (POSITION_SYMBOL)  == TradeSymbol)
         count++;
   }
   return(count);
}

// Reconcile registry with reality: create states for new managed positions,
// migrate tickets after partial closes, free slots for closed positions.
void ReconcileTradeStates()
{
   int total = PositionsTotal();
   // pass 1: mark states whose position still exists
   for(int i = 0; i < 64; i++)
   {
      if(!g_states[i].inUse) continue;
      bool found = false;
      for(int p = 0; p < total; p++)
      {
         ulong ticket = PositionGetTicket(p);
         if(ticket == g_states[i].ticket && PositionSelectByTicket(ticket)) { found = true; break; }
      }
      if(!found)
      {
         // try to migrate: an identical position (entry + side) may live under a new ticket
         bool migrated = false;
         for(int p = 0; p < total; p++)
         {
            ulong ticket = PositionGetTicket(p);
            if(ticket == 0) continue;
            if(!PositionSelectByTicket(ticket)) continue;
            if(PositionGetInteger(POSITION_MAGIC)  != (long)MagicNumber) continue;
            if(PositionGetString (POSITION_SYMBOL) != TradeSymbol) continue;
            if(StateIndexByTicket(ticket) >= 0) continue;
            long ptype = PositionGetInteger(POSITION_TYPE);
            int dir = (ptype == POSITION_TYPE_BUY) ? 1 : -1;
            double entry = PositionGetDouble(POSITION_PRICE_OPEN);
            if(dir == g_states[i].direction && MathAbs(entry - g_states[i].entry) < 0.00001)
            {
               g_states[i].ticket = ticket;
               migrated = true;
               break;
            }
         }
         if(!migrated) g_states[i].inUse = false;
      }
   }

   // pass 2: create states for managed positions without one
   double digits = (double)SymbolInfoInteger(TradeSymbol, SYMBOL_DIGITS);
   for(int p = 0; p < total; p++)
   {
      ulong ticket = PositionGetTicket(p);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC)  != (long)MagicNumber) continue;
      if(PositionGetString (POSITION_SYMBOL) != TradeSymbol) continue;
      if(StateIndexByTicket(ticket) >= 0) continue;

      int slot = FindStateSlot();
      if(slot < 0) break;
      long ptype = PositionGetInteger(POSITION_TYPE);
      TradeState &st = g_states[slot];
      st.inUse = true;
      st.ticket = ticket;
      st.direction = (ptype == POSITION_TYPE_BUY) ? 1 : -1;
      st.entry = PositionGetDouble(POSITION_PRICE_OPEN);
      st.sl = PositionGetDouble(POSITION_SL);
      st.tp1 = 0; st.tp2 = 0; st.tp3 = 0;
      st.tp1Hit = false; st.tp2Hit = false; st.trailingActive = false;
      // best-effort TP reconstruction from the position (single TP = tp3)
      double tp = PositionGetDouble(POSITION_TP);
      if(tp > 0)
      {
         double risk = st.sl > 0 ? MathAbs(st.sl - st.entry) : 0.0;
         if(st.direction > 0)
         {
            st.tp3 = tp;
            if(risk > 0) { st.tp1 = st.entry + TpR1 * risk; st.tp2 = st.entry + TpR2 * risk; }
         }
         else
         {
            st.tp3 = tp;
            if(risk > 0) { st.tp1 = st.entry - TpR1 * risk; st.tp2 = st.entry - TpR2 * risk; }
         }
      }
   }
}

double RoundVolume(double vol)
{
   double vmin  = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_STEP);
   if(vstep <= 0.0) vstep = 0.01;
   double v = MathFloor(vol / vstep + 0.0000001) * vstep;
   if(v < vmin) v = vmin;
   if(v > vmax) v = vmax;
   v = NormalizeDouble(v, 2);
   return(v);
}

void TryModifySl(TradeState &st, double newSl)
{
   int digits = (int)SymbolInfoInteger(TradeSymbol, SYMBOL_DIGITS);
   double pnt = SymbolInfoDouble(TradeSymbol, SYMBOL_POINT);
   double sl = NormalizeDouble(newSl, digits);
   double stopsLevel = (double)SymbolInfoInteger(TradeSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopsLevel * pnt;
   double stopDist = MathAbs(st.entry - sl);
   if(stopsLevel > 0.0 && stopDist < minDist)
   {
      PrintFormat("AlgoVault EA: SL move skipped (%.5f -> %.5f): inside broker stop level", st.sl, sl);
      return;
   }
   if(!PositionSelectByTicket(st.ticket)) return;
   double tp = PositionGetDouble(POSITION_TP);
   if(!trade.PositionModify(st.ticket, sl, tp))
      PrintFormat("AlgoVault EA: SL modify rejected retcode=%d", trade.ResultRetcode());
   else
   {
      st.sl = sl;
      PrintFormat("AlgoVault EA: SL updated to %.5f", sl);
   }
}

void ClosePartialFor(TradeState &st, double pct)
{
   if(!PositionSelectByTicket(st.ticket)) return;
   double volume = PositionGetDouble(POSITION_VOLUME);
   double vmin  = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MIN);
   double vstep = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_STEP);
   if(vstep <= 0.0) vstep = 0.01;

   double target = MathFloor(volume * pct / 100.0 / vstep + 0.0000001) * vstep;
   if(target < vmin)
   {
      // too small to close partially: either close full remainder or skip
      if(volume < vmin) return;                    // nothing tradable
      target = MathMin(volume, vmin);              // close a minimal chunk
   }
   double remain = volume - target;
   if(remain > 0.0 && remain < vmin) target = volume; // avoid dust lots: close all

   if(target >= volume)
   {
      trade.PositionClose(st.ticket);
      Print("AlgoVault EA: full close at partial-TP (remainder below min lot)");
   }
   else if(target >= vmin)
   {
      if(!trade.PositionClosePartial(st.ticket, target))
         PrintFormat("AlgoVault EA: partial close rejected retcode=%d", trade.ResultRetcode());
      else
         PrintFormat("AlgoVault EA: partial close %.2f lots at TP", target);
   }
}

void ManagePositions()
{
   double bid = SymbolInfoDouble(TradeSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(TradeSymbol, SYMBOL_ASK);

   for(int i = 0; i < 64; i++)
   {
      if(!g_states[i].inUse) continue;
      TradeState &st = g_states[i];
      if(!PositionSelectByTicket(st.ticket)) continue;
      long ptype = PositionGetInteger(POSITION_TYPE);
      bool isLong = (ptype == POSITION_TYPE_BUY);
      if((isLong && st.direction != 1) || (!isLong && st.direction != -1)) continue;

      // ---- TP1 partial close -------------------------------------------
      if(!st.tp1Hit && st.tp1 > 0.0)
      {
         if((isLong && bid >= st.tp1) || (!isLong && ask <= st.tp1))
         {
            if(PartialClosePctR1 > 0.0) ClosePartialFor(st, PartialClosePctR1);
            st.tp1Hit = true;
            if(MoveBeAfterTp1 && CountManagedPositions() > 0)
               TryModifySl(st, st.entry);  // break-even to entry
         }
      }

      // ---- TP2 partial close -------------------------------------------
      if(st.tp1Hit && !st.tp2Hit && st.tp2 > 0.0)
      {
         if((isLong && bid >= st.tp2) || (!isLong && ask <= st.tp2))
         {
            if(PartialClosePctR2 > 0.0) ClosePartialFor(st, PartialClosePctR2);
            st.tp2Hit = true;
            if(LockAfterTp2 && CountManagedPositions() > 0)
               TryModifySl(st, st.tp1);    // lock in TP1 level
         }
      }

      // ---- TP3 / trailing activation ------------------------------------
      if(EnableTrailing && st.tp1Hit && st.tp2Hit && !st.trailingActive && st.tp3 > 0.0)
      {
         if((isLong && bid >= st.tp3) || (!isLong && ask <= st.tp3))
            st.trailingActive = true;
      }
      if(st.trailingActive)
      {
         double atrVal = (f_setup.valid ? f_setup.atr : PositionGetDouble(POSITION_PRICE_OPEN) * 0.0);
         if(atrVal <= 0.0) atrVal = MathAbs(ask - bid);
         double trailSl = isLong ? (bid - TrailingStopAtr * atrVal) : (ask + TrailingStopAtr * atrVal);
         if((isLong && trailSl > st.sl) || (!isLong && trailSl < st.sl))
            TryModifySl(st, trailSl);
      }
   }
}

void CloseAllManaged(string reason)
{
   int total = PositionsTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC)  == (long)MagicNumber &&
         PositionGetString (POSITION_SYMBOL) == TradeSymbol)
      {
         if(!trade.PositionClose(ticket))
            PrintFormat("AlgoVault EA: close rejected retcode=%d (%s)", trade.ResultRetcode(), reason);
      }
   }
}
`;

function inputsSection(ctx: MQL5BuildContext): string {
    return `
//+------------------------------------------------------------------+
//| Inputs (defaults from the Strategy Lab strategy)                  |
//+------------------------------------------------------------------+
input ulong  MagicNumber        = ${ctx.magicNumber};   // Magic number (strategy/version/symbol)
input string OrderComment       = "${ctx.comment}";     // Order comment
input string TradeSymbol        = "${ctx.symbol}";      // Trading symbol
input ENUM_TIMEFRAMES SetupTimeframe = ${ctx.tfToEnum[ctx.setupTf]}; // Entry timeframe (attach to this chart TF)

input bool   EnableTrading      = true;                 // Enable trading
input int    MaxSlippagePoints  = ${ctx.maxSlippagePoints}; // Max deviation in points

input bool   UsePercentRisk     = ${ctx.riskMode === "percent" ? "true" : "false"};
input double RiskPercent        = ${String(ctx.riskPercent)};
input double FixedLot           = ${String(ctx.fixedLot)};
input int    MaxPositions       = ${ctx.maxPositions};
input int    MaxTradesPerDay    = ${ctx.maxTradesPerDay};
input int    CooldownCandles    = ${ctx.cooldownCandles};
input double DailyLossLimitPct  = ${String(ctx.dailyLossLimitPct)};
input double MaxDrawdownPct     = ${String(ctx.maxDrawdownPct)};

input double TpR1               = ${String(ctx.tpR1)};
input double TpR2               = ${String(ctx.tpR2)};
input double TpR3               = ${String(ctx.tpR3)};
input double TpFixedDistance    = ${String(ctx.tpFixedDistance)};
input double SlAtrMultiple      = ${String(ctx.slAtrMultiple)};
input double SlLevelOffset      = ${String(ctx.slLevelOffset)};
input double PartialClosePctR1  = ${String(ctx.tpPartialR1Pct)};
input double PartialClosePctR2  = ${String(ctx.tpPartialR2Pct)};
input bool   MoveBeAfterTp1     = ${ctx.moveBeAfterTp1 ? "true" : "false"};
input bool   LockAfterTp2       = ${ctx.lockAfterTp2 ? "true" : "false"};
input bool   EnableTrailing     = ${ctx.trailingEnabled ? "true" : "false"};
input double TrailingStopAtr    = ${String(ctx.trailingStopAtr)};

input double MaxSpreadPoints    = ${String(ctx.maxSpreadPoints)}; // 0 = off
`;

}

/**
 * Assembles the complete MQL5 Expert Advisor source from the validated
 * context. Throws when the context is inconsistent (caught by the generator).
 */
export function buildMQL5Source(ctx: MQL5BuildContext): string {
    const isLong = ctx.direction === "long";
    const sessionsList = ctx.sessions.join(",");
    const regimesList = ctx.regimes.join(",");
    const weekdaysBitmask = ctx.weekdaysBitmask > 0 ? ctx.weekdaysBitmask : 255;

    const featureVars =
        ctx.usedTimeframes.map((tf) => `FeatureState f_${tf};\n`).join("") +
        // f_setup aliases the setup-timeframe feature state so the fixed
        // trade-management/filter blocks reference it without a duplicate
        // declaration.
        `#define f_setup f_${ctx.setupTf}\n`;
    const featureLoads = ctx.usedTimeframes
        .map((tf) => `   LoadFeatureState(f_${tf}, ${ctx.tfToEnum[tf]});`)
        .join("\n");

    const entryExpr = ctx.entryExpression && ctx.entryExpression !== "true"
        ? `   // Entry rules (deterministic translation of the strategy)\n   if(!(${ctx.entryExpression})) return(false);`
        : "";
    const confExpr = ctx.confirmationExpression
        ? `   // Confirmation rules\n   if(!(${ctx.confirmationExpression})) return(false);`
        : "";

    const regimeFilter = ctx.useRegime
        ? `
   // Regime filter
   {
      string rg = DetectRegime(SetupTimeframe);
      if(!StrIn(rg, "${regimesList}"))
         return(false);
   }`
        : "";

    const sessionFilter = ctx.sessions.length > 0
        ? `
   // Session filter (setup timeframe, UTC)
   if(!StrIn(f_setup.session, "${sessionsList}"))
      return(false);`
        : "";

    const weekdayFilter = weekdaysBitmask !== 255
        ? `
   // Day-of-week filter
   if(((1 << f_setup.weekdayUtc) & ${weekdaysBitmask}) == 0)
      return(false);`
        : "";

    const volFilters = [
        ctx.volMinAtrPct > 0 ? `   if(f_setup.atrPct < ${String(ctx.volMinAtrPct)}) return(false);` : "",
        ctx.volMaxAtrPct > 0 ? `   if(f_setup.atrPct > ${String(ctx.volMaxAtrPct)}) return(false);` : "",
    ].join("\n");

    const spreadFilter = ctx.maxSpreadPoints > 0
        ? `
   // Spread filter (points)
   if((double)SymbolInfoInteger(TradeSymbol, SYMBOL_SPREAD) > (double)MaxSpreadPoints)
      return(false);`
        : "";

    const slCode = ctx.slMode === "atr"
        ? `double sl = ${isLong ? "entryPrice - SlAtrMultiple * atr" : "entryPrice + SlAtrMultiple * atr"};`
        : `double sl = ${isLong ? "entryPrice - SlLevelOffset" : "entryPrice + SlLevelOffset"};`;

    const tpCode = ctx.tpMode === "r"
        ? `double tp1 = ${isLong ? "entryPrice + TpR1 * riskPrice" : "entryPrice - TpR1 * riskPrice"};
   double tp2 = ${isLong ? "entryPrice + TpR2 * riskPrice" : "entryPrice - TpR2 * riskPrice"};
   double tp3 = ${isLong ? "entryPrice + TpR3 * riskPrice" : "entryPrice - TpR3 * riskPrice"};`
        : `double tp1 = ${isLong ? "entryPrice + TpFixedDistance" : "entryPrice - TpFixedDistance"};
   double tp2 = ${isLong ? "entryPrice + TpFixedDistance * 2.0" : "entryPrice - TpFixedDistance * 2.0"};
   double tp3 = ${isLong ? "entryPrice + TpFixedDistance * 3.0" : "entryPrice - TpFixedDistance * 3.0"};`;

    // whole program
    const program = `#property copyright "AlgoVault Trading Platform"
#property link      "https://algovault.com"
#property version   "${ctx.eaVersion}"
#property strict
#property description "AlgoVault EA — deterministic compile of Strategy Lab strategy"
#property description "Strategy: ${ctx.strategyName} | ID: ${ctx.strategyId} | v${ctx.strategyVersion}"
#property description "Generator: ${ctx.generatorVersion} | Hash: ${ctx.strategyHash} | Magic: ${ctx.magicNumber}"

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>
#include <Trade\\OrderInfo.mqh>
#include <Trade\\AccountInfo.mqh>

CTrade        trade;
CPositionInfo posInfo;
COrderInfo    ordInfo;
CAccountInfo  accInfo;

// ─────────────────────────────────────────────────────────────────────
// EA identity (unique per user + strategy + version + symbol + account)
// ─────────────────────────────────────────────────────────────────────
input string  EAStrategyId     = "${ctx.strategyId}";
input string  EAStrategyVersion = "${ctx.strategyVersion}";
input string  EAConfigHash     = "${ctx.strategyHash}";
${inputsSection(ctx)}
//+------------------------------------------------------------------+
//| Trade management configuration (compiled from the strategy)       |
//+------------------------------------------------------------------+
input bool    MoveBEEnabled   = ${ctx.moveBeAfterTp1 ? "true" : "false"};
input bool    LockEnabled     = ${ctx.lockAfterTp2 ? "true" : "false"};

//+------------------------------------------------------------------+
//| Globals                                                           |
//+------------------------------------------------------------------+
datetime g_lastSetupBarTime = 0;
datetime g_lastDayKey       = 0;
int      g_tradesToday      = 0;
double   g_dayStartEquity   = 0.0;
double   g_peakEquity       = 0.0;
bool     g_dailyBlocked     = false;
bool     g_drawdownBlocked  = false;
ulong    g_lastEntryTicket  = 0;

${featureVars}
${FEATURE_STRUCT}
${HELPERS}
${FEATURE_ENGINE}
${REGIME_ENGINE}
${TRADE_MANAGEMENT}

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("AlgoVault EA: ${ctx.eaName} v${ctx.eaVersion}");
   Print("Strategy: ${ctx.strategyName} | ID: ${ctx.strategyId} | Version: ${ctx.strategyVersion} | Hash: ${ctx.strategyHash}");
   Print("Generator: ${ctx.generatorVersion} | Magic: ${ctx.magicNumber} | Symbol: ${ctx.symbol} | Setup TF: ${ctx.setupTf}");

   if(!SymbolSelect(TradeSymbol, true))
   {
      Print("ERROR: symbol not available: ", TradeSymbol);
      return(INIT_FAILED);
   }
   if(_Symbol != TradeSymbol)
   {
      Print("ERROR: attach this EA to the ", TradeSymbol, " chart (TradeSymbol input).");
      return(INIT_FAILED);
   }
   if(_Period != SetupTimeframe)
   {
      Print("ERROR: attach to a ", TradeSymbol, " ", EnumToString(SetupTimeframe), " chart (SetupTimeframe input).");
      return(INIT_FAILED);
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints((ulong)MathMax(0, MaxSlippagePoints));
   trade.SetTypeFillingBySymbol(TradeSymbol);

   g_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_lastSetupBarTime = iTime(TradeSymbol, SetupTimeframe, 1);
   UpdateDailyReset();

${featureLoads}
   ReconcileTradeStates();
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("AlgoVault EA: deinitialized (reason=", reason, ")");
}

//+------------------------------------------------------------------+
//| Daily reset (UTC day of the last closed setup bar)                |
//+------------------------------------------------------------------+
void UpdateDailyReset()
{
   datetime lastClosed = iTime(TradeSymbol, SetupTimeframe, 1);
   if(lastClosed <= 0) return;
   datetime utcDay = ToUtc(lastClosed);
   datetime dayKey = (datetime)((long)(utcDay / 86400) * 86400);
   if(dayKey == g_lastDayKey) return;
   g_lastDayKey = dayKey;
   g_tradesToday = 0;
   g_dailyBlocked = false;
   g_dayStartEquity = AccountInfoDouble(ACCOUNT_BALANCE);
   if(g_peakEquity <= 0.0) g_peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);
}

//+------------------------------------------------------------------+
//| Risk limits (daily loss + account drawdown)                       |
//+------------------------------------------------------------------+
void CheckRiskLimits()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity > g_peakEquity) g_peakEquity = equity;

   if(MaxDrawdownPct > 0.0 && g_peakEquity > 0.0)
   {
      double dd = (g_peakEquity - equity) / g_peakEquity * 100.0;
      if(dd >= MaxDrawdownPct)
      {
         CloseAllManaged("drawdown limit");
         g_drawdownBlocked = true;
      }
      else if(g_drawdownBlocked)
      {
         g_drawdownBlocked = false;
         Print("AlgoVault EA: drawdown back under limit — entries re-enabled");
      }
   }

   if(DailyLossLimitPct > 0.0)
   {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double managedFloat = 0.0;
      int total = PositionsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong t = PositionGetTicket(i);
         if(t == 0) continue;
         if(!PositionSelectByTicket(t)) continue;
         if(PositionGetInteger(POSITION_MAGIC) == (long)MagicNumber &&
            PositionGetString (POSITION_SYMBOL) == TradeSymbol)
            managedFloat += PositionGetDouble(POSITION_PROFIT);
      }
      double dayPnl = (balance + managedFloat) - g_dayStartEquity;
      if(dayPnl < -(balance * DailyLossLimitPct / 100.0))
      {
         CloseAllManaged("daily loss limit");
         g_dailyBlocked = true;
      }
   }
}

//+------------------------------------------------------------------+
//| Entry evaluation                                                  |
//+------------------------------------------------------------------+
bool EntryConditionPassed()
{
${entryExpr}
${confExpr}
   return(true);
}

bool CanEnter()
{
   if(!EnableTrading) return(false);
   if(CountManagedPositions() >= MaxPositions) return(false);
   if(g_dailyBlocked) return(false);
   if(g_drawdownBlocked) return(false);
   if(g_tradesToday >= MaxTradesPerDay) return(false);

   datetime lastClosed = iTime(TradeSymbol, SetupTimeframe, 1);
   if(g_lastEntryBarTime > 0 &&
      lastClosed < g_lastEntryBarTime + (datetime)(CooldownCandles) * PeriodSeconds(SetupTimeframe))
      return(false);
${sessionFilter}
${weekdayFilter}
${volFilters}
${regimeFilter}
${spreadFilter}
   return(EntryConditionPassed());
}

//+------------------------------------------------------------------+
//| Entry execution                                                   |
//+------------------------------------------------------------------+
void TryEnter()
{
   double bid = SymbolInfoDouble(TradeSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(TradeSymbol, SYMBOL_ASK);
   bool isLong = ${isLong ? "true" : "false"};
   double entryPrice = isLong ? ask : bid;
   double atr = f_setup.valid ? f_setup.atr : (ask - bid);

   ${slCode}
   sl = NormalizeDouble(sl, (int)SymbolInfoInteger(TradeSymbol, SYMBOL_DIGITS));
   double riskPrice = MathAbs(entryPrice - sl);
   if(riskPrice <= 0.0)
   {
      Print("AlgoVault EA: entry skipped — riskPrice <= 0");
      return;
   }

   ${tpCode}
   int digits = (int)SymbolInfoInteger(TradeSymbol, SYMBOL_DIGITS);
   double tp1n = NormalizeDouble(tp1, digits);
   double tp2n = NormalizeDouble(tp2, digits);
   double tp3n = NormalizeDouble(tp3, digits);

   // broker minimum stop distance
   double stopsLevel = (double)SymbolInfoInteger(TradeSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   double pnt = SymbolInfoDouble(TradeSymbol, SYMBOL_POINT);
   if(stopsLevel > 0.0 && MathAbs(entryPrice - sl) / pnt < stopsLevel)
   {
      PrintFormat("AlgoVault EA: entry skipped — SL %.5f inside broker stop level (%.0f pts)", sl, stopsLevel);
      return;
   }

   double volume;
   if(UsePercentRisk)
   {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double contract = SymbolInfoDouble(TradeSymbol, SYMBOL_TRADE_CONTRACT_SIZE);
      if(contract <= 0.0) contract = 100.0;
      volume = balance * (RiskPercent / 100.0) / (riskPrice * contract);
   }
   else
   {
      volume = FixedLot;
   }
   volume = MathRound(volume * 100.0) / 100.0;
   if(volume <= 0.0)
   {
      Print("AlgoVault EA: entry skipped — computed volume <= 0");
      return;
   }
   double vmin = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MIN);
   double rounded = RoundVolume(volume);
   if(rounded < vmin)
   {
      PrintFormat("AlgoVault EA: entry skipped — volume %.2f below broker minimum %.2f", volume, vmin);
      return;
   }

   ulong brokerTp = EnableTrailing ? 0UL : tp3n;
   if(!trade.PositionOpen(TradeSymbol, isLong ? ORDER_TYPE_BUY : ORDER_TYPE_SELL,
                          rounded, entryPrice, sl, brokerTp, OrderComment))
   {
      PrintFormat("AlgoVault EA: open rejected retcode=%d", trade.ResultRetcode());
      return;
   }

   int slot = FindStateSlot();
   if(slot >= 0)
   {
      TradeState &st = g_states[slot];
      st.inUse = true;
      st.ticket = trade.ResultOrder();
      st.direction = isLong ? 1 : -1;
      st.entry = entryPrice;
      st.sl = sl;
      st.tp1 = tp1n;
      st.tp2 = tp2n;
      st.tp3 = tp3n;
      st.tp1Hit = false;
      st.tp2Hit = false;
      st.trailingActive = false;
   }
   g_lastEntryBarTime = iTime(TradeSymbol, SetupTimeframe, 1);
   g_tradesToday++;
   PrintFormat("AlgoVault EA: entry %s %.2f lots @ %.5f sl=%.5f tp=%s",
               isLong ? "BUY" : "SELL", rounded, entryPrice, sl,
               EnableTrailing ? "trailing" : DoubleToString(tp3n, digits));
}

//+------------------------------------------------------------------+
//| Tick handler                                                      |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!EnableTrading) return;

   UpdateDailyReset();
   ReconcileTradeStates();
   ManagePositions();
   CheckRiskLimits();

   datetime lastClosed = iTime(TradeSymbol, SetupTimeframe, 1);
   if(lastClosed <= 0) return;
   if(lastClosed == g_lastSetupBarTime) return;
   g_lastSetupBarTime = lastClosed;

${featureLoads}

   if(!CanEnter()) return;
   TryEnter();
}
`;

    // last entry bar tracking global
    const withEntryBar = program.replace(
        "datetime g_lastSetupBarTime = 0;",
        "datetime g_lastSetupBarTime = 0;\ndatetime g_lastEntryBarTime = 0;"
    );

    return withEntryBar;
}

/** Sanitizes an MQL5 identifier / comment fragment. */
export function mql5SafeName(name: string, fallback = "Strategy"): string {
    const clean = name
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    return clean.length > 0 ? clean.slice(0, 40) : fallback;
}

/** Builds the .mq5 file name from strategy name + symbol + EA version. */
export function mql5FileName(name: string, symbol: string, eaVersion: string): string {
    return `AlgoVault_${mql5SafeName(name)}_${symbol}_EA_${eaVersion.replace(/\./g, "_")}.mq5`;
}