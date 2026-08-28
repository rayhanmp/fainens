export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, quantile));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function robustHistoricalStats(values: number[], plannedAmount: number, reviewedOutlierWeight = 0.2): {
  typical: number;
  low: number;
  high: number;
  outlierCount: number;
} {
  if (values.length === 0) return { typical: 0, low: 0, high: 0, outlierCount: 0 };
  const median = percentile(values, 0.5) ?? 0;
  const deviations = values.map((value) => Math.abs(value - median));
  const mad = percentile(deviations, 0.5) ?? 0;
  // The budget provides a useful category-specific scale. The MAD and median
  // terms prevent a consistently expensive category from being mistaken for
  // an outlier simply because its absolute amount is large.
  const outlierThreshold = Math.max(250_000, plannedAmount * 0.75, median * 3, median + mad * 4);
  const adjusted = values.map((value) => Math.min(value, outlierThreshold));
  const outlierWeight = Math.max(0.05, Math.min(1, reviewedOutlierWeight));
  const weights = values.map((value) => value > outlierThreshold ? outlierWeight : 1);
  const weightedTotal = adjusted.reduce((sum, value, index) => sum + value * weights[index], 0);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    typical: weightedTotal / Math.max(1, totalWeight),
    low: percentile(adjusted, 0.25) ?? 0,
    high: percentile(adjusted, 0.75) ?? 0,
    outlierCount: values.filter((value) => value > outlierThreshold).length,
  };
}
