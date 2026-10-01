import type { SavedRecapStory } from './recap-schemas';

export function shortRecapLabel(value: string, limit = 28): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const firstItem = clean.split(/[,;]|\s+(?:and|dan|with|dengan)\s+/i)[0].trim();
  const subject = firstItem.replace(/\s+(?:at|di)\s+.+$/i, '').trim();
  if (subject.length <= limit) return subject;
  const words = subject.split(' ');
  let result = words.shift() ?? '';
  for (const word of words) {
    if (`${result} ${word}`.length > limit) break;
    result += ` ${word}`;
  }
  return result.length <= limit ? result.replace(/\s+(?:and|dan|with|dengan|at|di)$/i, '') : 'This item';
}

export function recapLabelSources(snapshot: SavedRecapStory['snapshot']): Record<string, string> {
  const labels: Record<string, string> = {};
  snapshot.categories.slice(0, 8).forEach((row, i) => { labels[`category${i + 1}`] = row.name; });
  snapshot.highlights?.topPurchases?.forEach((row, i) => {
    labels[`purchase${i + 1}`] = row.description;
    labels[`purchaseCategory${i + 1}`] = row.category;
  });
  snapshot.highlights?.repeatPurchases?.forEach((row, i) => {
    labels[`repeatPurchase${i + 1}`] = row.description;
    labels[`repeatCategory${i + 1}`] = row.category;
  });
  if (snapshot.largestPurchase) labels.standoutPurchase = snapshot.largestPurchase.description;
  snapshot.budget?.overBudgetCategories.forEach((row, i) => { labels[`budgetCategory${i + 1}`] = row.name; });
  return labels;
}

export function recapShortLabels(snapshot: SavedRecapStory['snapshot'], proposed: Record<string, string> = {}): Record<string, string> {
  const sources = recapLabelSources(snapshot);
  const labels = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, shortRecapLabel(value)]));
  for (const [key, value] of Object.entries(proposed)) {
    const source = sources[key];
    if (source == null) throw new Error('Unknown short-label reference');
    const sourceWords = new Set(source.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const words = value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const connectors = new Set(['and', 'at', 'with', 'the', 'di', 'dan', 'dengan']);
    // Summaries may select and reorder observed words, but must not invent a product,
    // merchant, mealtime or location. Invalid suggestions keep the bounded fallback.
    if (words.some(word => !connectors.has(word) && sourceWords.has(word)) && words.every(word => connectors.has(word) || sourceWords.has(word))) labels[key] = value.trim();
  }
  return labels;
}
