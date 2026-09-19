export type Time = number;

export interface Candle {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export type ChartType = "candlestick" | "line" | "area" | "bar";

export type DrawingTool =
    | "cursor"
    | "trendline"
    | "horizontal"
    | "vertical"
    | "ray"
    | "rectangle"
    | "fibonacci"
    | "delete";

export interface StudyDefinition {
    id: string;
    name: string;
    icon: string;
    color: string;
    compute: (data: Candle[]) => number[];
}

export interface PriceAlert {
    id: string;
    symbol: string;
    price: number;
    direction: "above" | "below";
    label?: string;
    triggered: boolean;
}

export interface ChartLayout {
    symbol: string;
    interval: string;
    chartType: ChartType;
    studies: string[];
    theme: "dark" | "light";
}

export interface UndoRedoState {
    past: unknown[][];
    future: unknown[][];
}
