/** Marketing product context layer.
 *  Reuses existing AlgoVault sources rather than inventing new product data.
 *  Sources: plugin catalog, workflow capabilities, marketplace features.
 */

export function buildProductContext(feature?: string) {
  return `AlgoVault provides trading automation, AI signals, market data visualization, workflow automation, and plugin integrations. Feature focus: ${feature || "AlgoVault platform"}. Always include risk disclosure: trading carries risk; past performance not indicative of future results. This content is for informational purposes only.`;
}
