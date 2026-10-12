export interface StrategyDef {
  id: string; name: string; symbol: string; timeframe: string;
  nodes: StrategyNode[]; version: number; createdAt: string;
}
export interface StrategyNode {
  type: 'market' | 'indicator' | 'condition' | 'action' | 'risk';
  config: Record<string, unknown>; children?: string[];
}
