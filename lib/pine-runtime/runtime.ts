import type { Candle } from "@/components/tradingview/TradingChart/types";
import { parse } from "./parser";
import type { Program, Statement, Expression, Block } from "./ast";
import { TA, MATH, ARRAY, COLOR, getDefaultSymbolInfo, getDefaultTimeframeInfo, getDefaultBarState } from "./builtins";

const hl2 = (candles: Candle[]) => candles.map(c => (c.high + c.low) / 2);
const hlc3 = (candles: Candle[]) => candles.map(c => (c.high + c.low + c.close) / 3);
const ohlc4 = (candles: Candle[]) => candles.map(c => (c.open + c.high + c.low + c.close) / 4);
const tr = (highs: number[], lows: number[], closes: number[]): number[] => {
  const out: number[] = new Array(highs.length).fill(0);
  out[0] = highs[0] - lows[0];
  for (let i = 1; i < highs.length; i++) {
    out[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  return out;
};
import type {
  PineExecutionResult, PlotOutput, HlineOutput, FillOutput, BgcolorOutput,
  BarcolorOutput, PlotShapeOutput, PlotCandleOutput, LineDrawing, LabelDrawing,
  BoxDrawing, AlertCondition, PineInput, StrategyState, StrategyTrade,
} from "./types";

export type { PineExecutionResult };

interface RuntimeContext {
  candles: Candle[];
  symbol: string;
  timeframe: string;
  barIndex: number;
}

interface VarScope {
  vars: Map<string, unknown>;
  parent?: VarScope;
}

function createScope(parent?: VarScope): VarScope {
  return { vars: new Map(), parent };
}

function scopeGet(scope: VarScope, name: string): unknown {
  if (scope.vars.has(name)) return scope.vars.get(name);
  if (scope.parent) return scopeGet(scope.parent, name);
  return undefined;
}

function scopeSet(scope: VarScope, name: string, value: unknown): void {
  scope.vars.set(name, value);
}

// Deduplication state for crossover/crossunder
const prevCrossoverState = new Map<string, boolean>();
const prevCrossunderState = new Map<string, boolean>();

export function executePine(source: string, candles: Candle[], symbol = "FX:EURUSD", timeframe = "1h"): PineExecutionResult {
  const result: PineExecutionResult = {
    plots: [], hlines: [], fills: [], bgcolors: [], barcolors: [],
    plotshapes: [], plotchars: [], plotcandles: [], lines: [], labels: [],
    boxes: [], alerts: [], inputs: [], strategy: null,
    title: "", overlay: false, errors: [],
  };

  let ast: Program;
  try {
    ast = parse(source);
  } catch (err) {
    result.errors.push(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  result.title = ast.metadata.title || "Pine Script";
  result.overlay = ast.metadata.overlay;

  // Always extract inputs and alertconditions (no candle data needed)
  extractInputs(ast, result);
  extractAlertConditions(ast, result);

  // If no candle data, return metadata-only result (no computation)
  if (candles.length === 0) {
    return result;
  }

  // Run the script with candle data
  try {
    runProgram(ast, { candles, symbol, timeframe, barIndex: 0 }, result);
  } catch (err) {
    result.errors.push(`Runtime error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

function extractInputs(ast: Program, result: PineExecutionResult): void {
  for (const stmt of ast.body) {
    if (stmt.type === "VariableDeclaration" && stmt.value.type === "FunctionCall") {
      const fc = stmt.value;
      if (fc.name === "input" || (fc.namespace === "input")) {
        const inputType = fc.namespace === "input" ? fc.name : "unknown";
        const defaultVal = fc.args.find(a => !a.name || a.name === "defval")?.value;
        const titleArg = fc.args.find(a => a.name === "title");
        const title = titleArg?.value.type === "StringLiteral" ? (titleArg.value as import("./ast").StringLiteral).value : stmt.name;

        let type: PineInput["type"] = "float";
        let defaultValue: unknown = 0;

        if (inputType === "int") {
          type = "int";
          defaultValue = defaultVal?.type === "NumberLiteral" ? (defaultVal as import("./ast").NumberLiteral).value : 0;
        } else if (inputType === "float") {
          type = "float";
          defaultValue = defaultVal?.type === "NumberLiteral" ? (defaultVal as import("./ast").NumberLiteral).value : 0;
        } else if (inputType === "bool") {
          type = "bool";
          defaultValue = defaultVal?.type === "BoolLiteral" ? (defaultVal as import("./ast").BoolLiteral).value : false;
        } else if (inputType === "string") {
          type = "string";
          defaultValue = defaultVal?.type === "StringLiteral" ? (defaultVal as import("./ast").StringLiteral).value : "";
        } else if (inputType === "source") {
          type = "source";
          defaultValue = "close";
        } else if (inputType === "timeframe") {
          type = "timeframe";
          defaultValue = "1D";
        } else if (inputType === "symbol") {
          type = "symbol";
          defaultValue = "FX:EURUSD";
        } else if (inputType === "color") {
          type = "color";
          defaultValue = "#2196F3";
        }

        result.inputs.push({ name: stmt.name, label: title, type, defaultValue });
      }
    }
  }
}

function extractAlertConditions(ast: Program, result: PineExecutionResult): void {
  for (const stmt of ast.body) {
    if (stmt.type === "FunctionCall" && !stmt.namespace) {
      const fn = stmt.name.toLowerCase();
      if (fn === "alertcondition") {
        const titleArg = stmt.args.find(a => a.name === "title");
        const messageArg = stmt.args.find(a => a.name === "message");
        const title = titleArg?.value.type === "StringLiteral" ? (titleArg.value as import("./ast").StringLiteral).value : `Alert ${result.alerts.length + 1}`;
        const message = messageArg?.value.type === "StringLiteral" ? (messageArg.value as import("./ast").StringLiteral).value : "Alert triggered";
        result.alerts.push({
          id: `alert_${result.alerts.length}`,
          title,
          message,
          condition: () => false,
        });
      }
    }
  }
}

function resolveExpr(expr: Expression, ctx: RuntimeContext, scope: VarScope, result: PineExecutionResult): unknown {
  switch (expr.type) {
    case "NumberLiteral": return expr.value;
    case "StringLiteral": return expr.value;
    case "BoolLiteral": return expr.value;
    case "NaLiteral": return NaN;
    case "Identifier": {
      const val = scopeGet(scope, expr.name);
      if (val !== undefined) return val;
      return undefined;
    }
    case "BinaryExpression": {
      const left = resolveExpr(expr.left, ctx, scope, result);
      const right = resolveExpr(expr.right, ctx, scope, result);
      return evalBinaryOp(expr.operator, left, right);
    }
    case "UnaryExpression": {
      const val = resolveExpr(expr.operand, ctx, scope, result);
      if (Array.isArray(val)) {
        return val.map((v) => {
          if (expr.operator === "-") return -Number(v);
          if (expr.operator === "not" || expr.operator === "!") return !v;
          return v;
        });
      }
      if (expr.operator === "-") return -(val as number);
      if (expr.operator === "not" || expr.operator === "!") return !val;
      return val;
    }
    case "LogicalExpression": {
      const left = resolveExpr(expr.left, ctx, scope, result);
      const right = resolveExpr(expr.right, ctx, scope, result);
      return evalLogicalOp(expr.operator, left, right);
    }
    case "TernaryExpression": {
      const cond = resolveExpr(expr.condition, ctx, scope, result);
      if (Array.isArray(cond)) {
        const consequent = resolveExpr(expr.consequent, ctx, scope, result);
        const alternate = resolveExpr(expr.alternate, ctx, scope, result);
        return cond.map((c, i) => {
          const cVal = consequent instanceof Array ? consequent[i] : consequent;
          const aVal = alternate instanceof Array ? alternate[i] : alternate;
          return c ? cVal : aVal;
        });
      }
      return cond ? resolveExpr(expr.consequent, ctx, scope, result) : resolveExpr(expr.alternate, ctx, scope, result);
    }
    case "FunctionCall": {
      return callFunction(expr.namespace, expr.name, expr.args, ctx, scope, result);
    }
    case "FieldAccess": {
      // Builtin namespaced objects used as plain field access (barstate.islast,
      // syminfo.mintick, timeframe.isintraday) resolve against bar/symbol/period
      // info — the same sources the namespaced-call path uses below.
      if (expr.object.type === "Identifier") {
        const ns = expr.object.name;
        if (ns === "barstate") {
          const bs = getDefaultBarState(ctx.barIndex, ctx.candles.length);
          return (bs as unknown as Record<string, unknown>)[expr.field] ?? undefined;
        }
        if (ns === "syminfo") {
          const info = getDefaultSymbolInfo(ctx.symbol);
          return (info as unknown as Record<string, unknown>)[expr.field] ?? undefined;
        }
        if (ns === "timeframe") {
          const info = getDefaultTimeframeInfo(ctx.timeframe);
          return (info as unknown as Record<string, unknown>)[expr.field] ?? undefined;
        }
      }
      const obj = resolveExpr(expr.object, ctx, scope, result);
      if (obj && typeof obj === "object" && expr.field in obj) {
        return (obj as Record<string, unknown>)[expr.field];
      }
      return undefined;
    }
    case "ArrayLiteral": {
      return expr.elements.map(e => resolveExpr(e, ctx, scope, result));
    }
    case "TupleExpression": {
      return expr.elements.map(e => resolveExpr(e, ctx, scope, result));
    }
    default:
      return undefined;
  }
}

function evalScalarOp(op: string, l: number, r: number): number | boolean {
  switch (op) {
    case "+": return l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/": return r === 0 ? NaN : l / r;
    case "%": return r === 0 ? NaN : l % r;
    case "^": return Math.pow(l, r);
    case "==": return l === r;
    case "!=": return l !== r;
    case "<": return l < r;
    case ">": return l > r;
    case "<=": return l <= r;
    case ">=": return l >= r;
    default: return NaN;
  }
}

function evalBinaryOp(op: string, left: unknown, right: unknown): unknown {
  const leftArr = Array.isArray(left);
  const rightArr = Array.isArray(right);

  if (leftArr || rightArr) {
    const lArr: unknown[] = leftArr ? (left as unknown[]) : [];
    const rArr: unknown[] = rightArr ? (right as unknown[]) : [];
    const length = Math.max(leftArr ? lArr.length : 0, rightArr ? rArr.length : 0);
    const result: unknown[] = new Array(length);

    for (let i = 0; i < length; i++) {
      const lv = (leftArr ? lArr[i] : left) as number;
      const rv = (rightArr ? rArr[i] : right) as number;
      result[i] = evalScalarOp(op, lv, rv);
    }
    return result;
  }

  return evalScalarOp(op, left as number, right as number);
}

function evalLogicalOp(op: "and" | "or", left: unknown, right: unknown): unknown {
  const leftArr = Array.isArray(left);
  const rightArr = Array.isArray(right);

  if (leftArr || rightArr) {
    const lArr: unknown[] = leftArr ? (left as unknown[]) : [];
    const rArr: unknown[] = rightArr ? (right as unknown[]) : [];
    const length = Math.max(leftArr ? lArr.length : 0, rightArr ? rArr.length : 0);
    const result: boolean[] = new Array(length);

    for (let i = 0; i < length; i++) {
      const lv = leftArr ? Boolean(lArr[i]) : Boolean(left);
      const rv = rightArr ? Boolean(rArr[i]) : Boolean(right);
      result[i] = op === "and" ? lv && rv : lv || rv;
    }
    return result;
  }

  if (op === "and") return Boolean(left) && Boolean(right);
  return Boolean(left) || Boolean(right);
}

function callFunction(namespace: string | undefined, name: string, args: { name?: string; value: Expression }[], ctx: RuntimeContext, scope: VarScope, result: PineExecutionResult): unknown {
  const resolvedArgs = args.map(a => resolveExpr(a.value, ctx, scope, result));
  const ns = namespace?.toLowerCase();
  const fn = name.toLowerCase();
  const { candles } = ctx;
  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // Helper to resolve source argument to a series
  function resolveSource(arg: unknown): number[] {
    if (typeof arg === "string") {
      switch (arg.toLowerCase()) {
        case "close": return closes;
        case "open": return opens;
        case "high": return highs;
        case "low": return lows;
        case "volume": return volumes;
        case "hl2": return hl2(candles);
        case "hlc3": return hlc3(candles);
        case "ohlc4": return ohlc4(candles);
        default: return closes;
      }
    }
    if (Array.isArray(arg)) return arg as number[];
    return closes;
  }

  // ── ta.* ──
  if (ns === "ta") {
    if (fn === "sma") return TA.sma(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "ema") return TA.ema(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "wma") return TA.wma(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "rma") return TA.rma(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "rsi") return TA.rsi(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "macd") {
      const [macdLine, signal, hist] = TA.macd(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number, resolvedArgs[2] as number, resolvedArgs[3] as number);
      return [macdLine, signal, hist];
    }
    if (fn === "atr") return TA.atr(highs, lows, closes, resolvedArgs[0] as number);
    if (fn === "adx") return TA.adx(highs, lows, closes, resolvedArgs[0] as number);
    if (fn === "stoch") {
      const [k, d] = TA.stoch(resolveSource(resolvedArgs[0]), highs, lows, resolvedArgs[1] as number);
      return [k, d];
    }
    if (fn === "highest") return TA.highest(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "lowest") return TA.lowest(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "crossover") return TA.crossover(resolveSource(resolvedArgs[0]), resolveSource(resolvedArgs[1]));
    if (fn === "crossunder") return TA.crossunder(resolveSource(resolvedArgs[0]), resolveSource(resolvedArgs[1]));
    if (fn === "change") return TA.change(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number ?? 1);
    if (fn === "barssince") return TA.barssince(resolveSource(resolvedArgs[0]) as unknown as boolean[]);
    if (fn === "valuewhen") {
      const cond = resolveSource(resolvedArgs[0]) as unknown as boolean[];
      const src = resolveSource(resolvedArgs[1]);
      return TA.valuewhen(cond, src, resolvedArgs[2] as number);
    }
    if (fn === "pivothigh") return TA.pivothigh(highs, resolvedArgs[0] as number, resolvedArgs[1] as number);
    if (fn === "pivotlow") return TA.pivotlow(lows, resolvedArgs[0] as number, resolvedArgs[1] as number);
    if (fn === "bb") {
      const [basis, upper, lower] = TA.bb(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number, resolvedArgs[2] as number);
      return [basis, upper, lower];
    }
    if (fn === "cci") return TA.cci(highs, lows, closes, resolvedArgs[0] as number);
    if (fn === "psar") return TA.psar(highs, lows, resolvedArgs[0] as number, resolvedArgs[1] as number, resolvedArgs[2] as number);
    if (fn === "vwap") return TA.vwap(highs, lows, closes, volumes);
    if (fn === "obv") return TA.obv(closes, volumes);
    if (fn === "mfi") return TA.mfi(highs, lows, closes, volumes, resolvedArgs[0] as number);
    if (fn === "roc") return TA.roc(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "mom") return TA.momentum(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "vwma") return TA.vwma(resolveSource(resolvedArgs[0]), volumes, resolvedArgs[1] as number);
    if (fn === "hma") return TA.hma(resolveSource(resolvedArgs[0]), resolvedArgs[1] as number);
    if (fn === "tr") return tr(highs, lows, closes);
  }

  // ── math.* ──
  if (ns === "math") {
    const m = MATH[fn as keyof typeof MATH];
    if (m) return (m as Function)(...resolvedArgs);
  }

  // ── array.* ──
  if (ns === "array") {
    if (fn === "new_float") return ARRAY.new_float(resolvedArgs[0] as number, resolvedArgs[1] as number);
    if (fn === "new_int") return ARRAY.new_int(resolvedArgs[0] as number, resolvedArgs[1] as number);
    if (fn === "new_bool") return ARRAY.new_bool(resolvedArgs[0] as number, resolvedArgs[1] as boolean);
    if (fn === "push") { ARRAY.push(resolvedArgs[0] as unknown[], resolvedArgs[1]); return undefined; }
    if (fn === "pop") return ARRAY.pop(resolvedArgs[0] as unknown[]);
    if (fn === "shift") return ARRAY.shift(resolvedArgs[0] as unknown[]);
    if (fn === "unshift") { ARRAY.unshift(resolvedArgs[0] as unknown[], resolvedArgs[1]); return undefined; }
    if (fn === "get") return ARRAY.get(resolvedArgs[0] as unknown[], resolvedArgs[1] as number);
    if (fn === "set") { ARRAY.set(resolvedArgs[0] as unknown[], resolvedArgs[1] as number, resolvedArgs[2]); return undefined; }
    if (fn === "size") return ARRAY.size(resolvedArgs[0] as unknown[]);
    if (fn === "clear") { ARRAY.clear(resolvedArgs[0] as unknown[]); return undefined; }
    if (fn === "max") return ARRAY.max(resolvedArgs[0] as number[]);
    if (fn === "min") return ARRAY.min(resolvedArgs[0] as number[]);
    if (fn === "sum") return ARRAY.sum(resolvedArgs[0] as number[]);
  }

  // ── color.* ──
  if (ns === "color") {
    if (fn === "rgb") return COLOR.rgb(resolvedArgs[0] as number, resolvedArgs[1] as number, resolvedArgs[2] as number, resolvedArgs[3] as number);
    if (fn === "new") return COLOR.new(resolvedArgs[0] as string, resolvedArgs[1] as number);
  }

  // ── Built-in functions ──
  if (fn === "plot") {
    const title = args.find(a => a.name === "title")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "title")!.value as import("./ast").StringLiteral).value
      : `plot_${result.plots.length}`;
    const color = args.find(a => a.name === "color")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "color")!.value as import("./ast").StringLiteral).value
      : undefined;
    const linewidth = args.find(a => a.name === "linewidth")?.value?.type === "NumberLiteral"
      ? (args.find(a => a.name === "linewidth")!.value as import("./ast").NumberLiteral).value
      : undefined;
    const style = args.find(a => a.name === "style")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "style")!.value as import("./ast").StringLiteral).value
      : undefined;
    const values = resolveSource(resolvedArgs[0]);
    const id = `plot_${result.plots.length}`;
    result.plots.push({ id, title, values, color, lineWidth: linewidth, style });
    return undefined;
  }

  if (fn === "hline") {
    const value = resolvedArgs[0] as number;
    const title = args.find(a => a.name === "title")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "title")!.value as import("./ast").StringLiteral).value
      : `hline_${result.hlines.length}`;
    const color = args.find(a => a.name === "color")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "color")!.value as import("./ast").StringLiteral).value
      : undefined;
    const linestyle = args.find(a => a.name === "linestyle")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "linestyle")!.value as import("./ast").StringLiteral).value
      : undefined;
    result.hlines.push({ id: `hline_${result.hlines.length}`, title, value, color, linestyle });
    return undefined;
  }

  if (fn === "bgcolor") {
    const color = resolvedArgs[0] as string;
    result.bgcolors.push({ id: `bgcolor_${result.bgcolors.length}`, values: new Array(candles.length).fill(color) });
    return undefined;
  }

  if (fn === "barcolor") {
    const color = resolvedArgs[0] as string;
    result.barcolors.push({ values: new Array(candles.length).fill(color) });
    return undefined;
  }

  if (fn === "fill") {
    const fromPlotId = resolvedArgs[0] as string;
    const toPlotId = resolvedArgs[1] as string;
    const color = args.find(a => a.name === "color")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "color")!.value as import("./ast").StringLiteral).value
      : undefined;
    result.fills.push({ id: `fill_${result.fills.length}`, from: fromPlotId, to: toPlotId, color });
    return undefined;
  }

  if (fn === "plotshape") {
    const title = args.find(a => a.name === "title")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "title")!.value as import("./ast").StringLiteral).value
      : `plotshape_${result.plotshapes.length}`;
    const style = args.find(a => a.name === "style")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "style")!.value as import("./ast").StringLiteral).value
      : "shape_labelup";
    const location = args.find(a => a.name === "location")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "location")!.value as import("./ast").StringLiteral).value
      : "belowbar";
    const color = args.find(a => a.name === "color")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "color")!.value as import("./ast").StringLiteral).value
      : undefined;
    const text = args.find(a => a.name === "text")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "text")!.value as import("./ast").StringLiteral).value
      : undefined;
    const values = resolveSource(resolvedArgs[0]);
    result.plotshapes.push({
      id: `plotshape_${result.plotshapes.length}`, title, style, location, color,
      text, values: Array.isArray(values) ? values.map(v => Boolean(v)) : [],
    });
    return undefined;
  }

  if (fn === "plotcandle") {
    const title = args.find(a => a.name === "title")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "title")!.value as import("./ast").StringLiteral).value
      : `plotcandle_${result.plotcandles.length}`;
    result.plotcandles.push({
      id: `plotcandle_${result.plotcandles.length}`, title,
      open: resolveSource(resolvedArgs[0]) as number[],
      high: resolveSource(resolvedArgs[1]) as number[],
      low: resolveSource(resolvedArgs[2]) as number[],
      close: resolveSource(resolvedArgs[3]) as number[],
      color: resolvedArgs[4] as string | undefined,
    });
    return undefined;
  }

  if (fn === "alertcondition") {
    const cond = resolvedArgs[0];
    const title = args.find(a => a.name === "title")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "title")!.value as import("./ast").StringLiteral).value
      : "Alert";
    const message = args.find(a => a.name === "message")?.value?.type === "StringLiteral"
      ? (args.find(a => a.name === "message")!.value as import("./ast").StringLiteral).value
      : "Alert triggered";
    const alertId = `alert_${result.alerts.length}`;
    const condArray = Array.isArray(cond) ? cond as boolean[] : [];
    result.alerts.push({
      id: alertId, title, message,
      condition: (barIndex: number) => condArray[barIndex] ?? false,
    });
    return undefined;
  }

  if (fn === "line" && name.toLowerCase() === "new") {
    const id = `line_${result.lines.length}`;
    result.lines.push({
      id,
      x1: resolvedArgs[0] as number,
      y1: resolvedArgs[1] as number,
      x2: resolvedArgs[2] as number,
      y2: resolvedArgs[3] as number,
    });
    return id;
  }

  if (fn === "label" && name.toLowerCase() === "new") {
    const id = `label_${result.labels.length}`;
    result.labels.push({
      id,
      x: resolvedArgs[0] as number,
      y: resolvedArgs[1] as number,
      text: resolvedArgs[2] as string ?? "",
    });
    return id;
  }

  if (fn === "box" && name.toLowerCase() === "new") {
    const id = `box_${result.boxes.length}`;
    result.boxes.push({
      id,
      left: resolvedArgs[0] as number,
      top: resolvedArgs[1] as number,
      right: resolvedArgs[2] as number,
      bottom: resolvedArgs[3] as number,
    });
    return id;
  }

  // ── strategy.* ──
  if (ns === "strategy") {
    if (!result.strategy) {
      result.strategy = {
        position_size: 0, position_avg_price: 0, open_trades: [], closed_trades: [],
        equity: 10000, balance: 10000, initial_capital: 10000, commission: 0,
        win_count: 0, loss_count: 0, total_pnl: 0, max_drawdown: 0, peak_equity: 10000,
      };
    }
    const strat = result.strategy;
    const bar = ctx.candles[ctx.barIndex];
    const barHigh = bar.high;
    const barLow = bar.low;
    const barClose = closes[ctx.barIndex];

    if (fn === "entry") {
      const entryName = typeof resolvedArgs[0] === "string" ? resolvedArgs[0] : undefined;
      const dir = (resolvedArgs[1] as number) || 1;
      const price = barClose;
      const direction = dir >= 0 ? "long" : "short";

      if (strat.position_size !== 0) {
        if ((strat.position_size > 0 && direction === "long") || (strat.position_size < 0 && direction === "short")) {
          // Same direction — pyramiding not supported, skip.
        } else {
          // Reverse position: close existing, open new.
          const existing = strat.open_trades[0];
          if (existing) {
            existing.exitPrice = price;
            existing.exitBar = ctx.barIndex;
            existing.exitReason = "reverse";
            existing.pnl = existing.direction === "long"
              ? (price - existing.entryPrice) * existing.size
              : (existing.entryPrice - price) * existing.size;
            existing.pnlPercent = (existing.pnl / existing.entryPrice) * 100;
            strat.closed_trades.push(existing);
            strat.total_pnl += existing.pnl;
            strat.balance += existing.pnl;
            if (existing.pnl > 0) strat.win_count++;
            else strat.loss_count++;
            strat.open_trades.shift();
          }
        }
      }

      if (strat.position_size === 0 || (strat.position_size > 0 && direction === "short") || (strat.position_size < 0 && direction === "long")) {
        const trade: StrategyTrade = {
          id: `trade_${ctx.barIndex}_${Date.now().toString(36)}`,
          entryId: entryName,
          direction,
          entryPrice: price,
          entryBar: ctx.barIndex,
          size: 1,
        };
        strat.open_trades.push(trade);
        strat.position_size = direction === "long" ? 1 : -1;
        strat.position_avg_price = price;
      }
    }
    if (fn === "exit") {
      const exitId = resolvedArgs[0] as string | undefined;
      const stopArg = args.find(a => a.name === "stop");
      const limitArg = args.find(a => a.name === "limit");
      const stopPrice = stopArg ? resolveExpr(stopArg.value, ctx, scope, result) : undefined;
      const limitPrice = limitArg ? resolveExpr(limitArg.value, ctx, scope, result) : undefined;
      const sl = Array.isArray(stopPrice) ? stopPrice[ctx.barIndex] : (stopPrice as number | undefined);
      const tp = Array.isArray(limitPrice) ? limitPrice[ctx.barIndex] : (limitPrice as number | undefined);

      for (let t = strat.open_trades.length - 1; t >= 0; t--) {
        const openTrade = strat.open_trades[t];
        if (exitId && openTrade.entryId !== exitId && !openTrade.id.includes(exitId)) continue;

        let exitPrice: number | null = null;
        let exitReason: StrategyTrade["exitReason"] = "manual";

        if (openTrade.direction === "long") {
          if (sl !== undefined && sl !== null && barLow <= sl) {
            exitPrice = sl;
            exitReason = "sl";
          } else if (tp !== undefined && tp !== null && barHigh >= tp) {
            exitPrice = tp;
            exitReason = "tp";
          }
        } else {
          if (sl !== undefined && sl !== null && barHigh >= sl) {
            exitPrice = sl;
            exitReason = "sl";
          } else if (tp !== undefined && tp !== null && barLow <= tp) {
            exitPrice = tp;
            exitReason = "tp";
          }
        }

        if (exitPrice !== null) {
          openTrade.exitPrice = exitPrice;
          openTrade.exitBar = ctx.barIndex;
          openTrade.exitReason = exitReason;
          openTrade.pnl = openTrade.direction === "long"
            ? (exitPrice - openTrade.entryPrice) * openTrade.size
            : (openTrade.entryPrice - exitPrice) * openTrade.size;
          openTrade.pnlPercent = (openTrade.pnl / openTrade.entryPrice) * 100;
          strat.closed_trades.push(openTrade);
          strat.total_pnl += openTrade.pnl;
          strat.balance += openTrade.pnl;
          strat.position_avg_price = strat.open_trades.filter(tt => tt !== openTrade).length > 0
            ? strat.open_trades.filter(tt => tt !== openTrade).reduce((s, tt) => s + tt.entryPrice, 0) / strat.open_trades.filter(tt => tt !== openTrade).length
            : 0;
          if (strat.open_trades.length === 0) {
            strat.position_size = 0;
            strat.position_avg_price = 0;
          }
          if (openTrade.pnl > 0) strat.win_count++;
          else strat.loss_count++;
          strat.open_trades = strat.open_trades.filter(tt => tt !== openTrade);
        }
      }
    }
    if (fn === "close") {
      const closeId = resolvedArgs[0] as string | undefined;
      const price = closes[ctx.barIndex];
      const target = strat.open_trades.find((t) => !closeId || t.entryId === closeId || t.id.includes(closeId));
      if (target) {
        target.exitPrice = price;
        target.exitBar = ctx.barIndex;
        target.exitReason = "manual";
        target.pnl = target.direction === "long"
          ? (price - target.entryPrice) * target.size
          : (target.entryPrice - price) * target.size;
        target.pnlPercent = target.pnl !== undefined && target.entryPrice > 0
          ? (target.pnl / target.entryPrice) * 100 : 0;
        strat.closed_trades.push(target);
        strat.open_trades = strat.open_trades.filter(t => t !== target);
        strat.total_pnl += target.pnl || 0;
        strat.balance += target.pnl || 0;
        if (strat.open_trades.length === 0) {
          strat.position_size = 0;
          strat.position_avg_price = 0;
        }
        if ((target.pnl || 0) > 0) strat.win_count++; else strat.loss_count++;
      }
    }
    if (fn === "position_size") return strat.position_size;
    if (fn === "position_avg_price") return strat.position_avg_price;
    return undefined;
  }

  // ── syminfo / timeframe / barstate ──
  if (ns === "syminfo") {
    const info = getDefaultSymbolInfo(ctx.symbol);
    return (info as unknown as Record<string, unknown>)[fn] ?? undefined;
  }
  if (ns === "timeframe") {
    const info = getDefaultTimeframeInfo(ctx.timeframe);
    return (info as unknown as Record<string, unknown>)[fn] ?? undefined;
  }
  if (ns === "barstate") {
    const bs = getDefaultBarState(ctx.barIndex, ctx.candles.length);
    return (bs as unknown as Record<string, unknown>)[fn] ?? undefined;
  }

  // ── request.security ──
  if (ns === "request" && fn === "security") {
    // In our runtime, we execute against the provided data
    // The MTF resolution would need to fetch from the data provider
    // For now, resolve the expression against current data
    return resolveExpr(args[2]?.value ?? args[0]?.value, ctx, scope, result);
  }

  // ── strategy properties ──
  if (ns === "strategy") {
    if (fn === "long") return 1;
    if (fn === "short") return -1;
  }

  // ── hline.style_* ──
  if (ns === "hline" && fn.startsWith("style_")) return name;

  // ── plot.style_* ──
  if (ns === "plot" && fn.startsWith("style_")) return name;

  // ── shape.* ──
  if (ns === "shape" || ns === "location") return name;

  // ── color constants ──
  if (ns === "color") {
    const colorMap: Record<string, string> = {
      red: "#ef5350", green: "#26a69a", blue: "#2196F3", aqua: "#22d3ee",
      orange: "#ff9800", yellow: "#ffeb3b", purple: "#9c27b0", lime: "#8bc34a",
      pink: "#e91e63", white: "#ffffff", black: "#000000", gray: "#9e9e9e",
      silver: "#bdbdbd", maroon: "#800000", navy: "#000080", teal: "#008080",
      olive: "#808000", fuchsia: "#ff00ff", cyan: "#00bcd4",
    };
    if (fn in colorMap) return colorMap[fn];
  }

  // ── crossover / crossunder (check key) ──
  if (fn === "crossover" || fn === "crossunder") {
    const key = `${fn}_${ctx.barIndex}`;
    const isCrossOver = fn === "crossover";
    const arr1 = resolveSource(resolvedArgs[0]);
    const arr2 = resolveSource(resolvedArgs[1]);
    if (ctx.barIndex > 0) {
      if (isCrossOver) {
        return arr1[ctx.barIndex - 1] <= arr2[ctx.barIndex - 1] && arr1[ctx.barIndex] > arr2[ctx.barIndex];
      } else {
        return arr1[ctx.barIndex - 1] >= arr2[ctx.barIndex - 1] && arr1[ctx.barIndex] < arr2[ctx.barIndex];
      }
    }
    return false;
  }

  // ── table.* (gracefully ignored — TradingView UI-only) ──
  if (ns === "table") {
    if (fn === "new") return `table_${Math.random().toString(36).slice(2, 8)}`;
    return undefined;
  }

  // ── polyline.* (gracefully ignored) ──
  if (ns === "polyline") {
    if (fn === "new") return `polyline_${Math.random().toString(36).slice(2, 8)}`;
    return undefined;
  }

  // ── table.cell, table.row, table.delete ──
  if (ns === "table" && (fn === "cell" || fn === "row" || fn === "delete")) {
    return undefined;
  }

  // Fallback: return first resolved arg or 0
  return resolvedArgs[0] ?? 0;
}

function runProgram(ast: Program, ctx: RuntimeContext, result: PineExecutionResult): void {
  const scope = createScope();

  if (ctx.candles.length > 0 && ast.metadata.isStrategy) {
    for (let i = 0; i < ctx.candles.length; i++) {
      ctx.barIndex = i;
      runPass(ast, ctx, scope, result);
    }
    return;
  }

  runPass(ast, ctx, scope, result);
}

function runPass(ast: Program, ctx: RuntimeContext, scope: VarScope, result: PineExecutionResult): void {
  for (const stmt of ast.body) {
    runStatement(stmt, ctx, scope, result);
  }
}

function runStatement(stmt: Statement, ctx: RuntimeContext, scope: VarScope, result: PineExecutionResult): void {
  switch (stmt.type) {
    case "VariableDeclaration": {
      const val = resolveExpr(stmt.value, ctx, scope, result);
      scopeSet(scope, stmt.name, val);
      break;
    }
    case "Reassignment": {
      const val = resolveExpr(stmt.value, ctx, scope, result);
      if (stmt.target.type === "Identifier") {
        scopeSet(scope, stmt.target.name, val);
      }
      break;
    }
    case "IfStatement": {
      const cond = resolveExpr(stmt.condition, ctx, scope, result);
      const barCond = Array.isArray(cond)
        ? (ctx.barIndex < cond.length ? Boolean(cond[ctx.barIndex]) : false)
        : Boolean(cond);
      if (barCond) {
        if (stmt.consequent.type === "Block") {
          const childScope = createScope(scope);
          for (const s of stmt.consequent.body) runStatement(s, ctx, childScope, result);
        } else {
          runStatement(stmt.consequent, ctx, scope, result);
        }
      } else if (stmt.alternate) {
        if (stmt.alternate.type === "Block") {
          const childScope = createScope(scope);
          for (const s of stmt.alternate.body) runStatement(s, ctx, childScope, result);
        } else {
          runStatement(stmt.alternate, ctx, scope, result);
        }
      }
      break;
    }
    case "ForLoop": {
      const from = resolveExpr(stmt.from, ctx, scope, result) as number;
      const to = resolveExpr(stmt.to, ctx, scope, result) as number;
      const childScope = createScope(scope);
      for (let i = from; i < to; i++) {
        childScope.vars.set(stmt.variable, i);
        for (const s of stmt.body.body) runStatement(s, ctx, childScope, result);
      }
      break;
    }
    case "Block": {
      const childScope = createScope(scope);
      for (const s of stmt.body) runStatement(s, ctx, childScope, result);
      break;
    }
    case "FunctionCall": {
      resolveExpr(stmt as unknown as Expression, ctx, scope, result);
      break;
    }
    case "MethodCall": {
      resolveExpr(stmt as unknown as Expression, ctx, scope, result);
      break;
    }
    case "TypeDeclaration": {
      // Store type info for later construction
      scopeSet(scope, `__type_${stmt.name}`, stmt);
      break;
    }
    case "ReturnStatement": {
      if (stmt.value) resolveExpr(stmt.value, ctx, scope, result);
      break;
    }
  }
}
