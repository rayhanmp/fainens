import type { PeriodRecap, SavedRecapStory } from './queries';

export function shortDisplayLabel(value: string, limit = 28): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const subject = clean.split(/[,;]|\s+(?:and|dan|with|dengan)\s+/i)[0].replace(/\s+(?:at|di)\s+.+$/i, '').trim();
  if (subject.length <= limit) return subject;
  let result = '';
  for (const word of subject.split(' ')) {
    if (`${result}${result ? ' ' : ''}${word}`.length > limit) break;
    result += `${result ? ' ' : ''}${word}`;
  }
  return result.replace(/\s+(?:and|dan|with|dengan|at|di)$/i, '') || 'This item';
}

export function recapDisplayCopy(recap: PeriodRecap, edition?: SavedRecapStory) {
  const sources: Record<string, string> = {};
  recap.categories.slice(0, 8).forEach((row, i) => { sources[`category${i + 1}`] = row.name; });
  recap.highlights?.topPurchases?.forEach((row, i) => { sources[`purchase${i + 1}`] = row.description; });
  recap.highlights?.repeatPurchases?.forEach((row, i) => { sources[`repeatPurchase${i + 1}`] = row.description; });
  if (recap.largestPurchase) sources.standoutPurchase = recap.largestPurchase.description;
  recap.budget?.overBudgetCategories.forEach((row, i) => { sources[`budgetCategory${i + 1}`] = row.name; });
  const labels = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, edition?.copy.shortLabels?.[key] ?? shortDisplayLabel(value)]));
  // Old cached editions inserted hard-sliced labels into sentences. Repair those
  // display references without changing the saved copy or calling the provider.
  const replacements = new Map<string, string>();
  for (const [key, original] of Object.entries(sources)) {
    if (labels[key] === original) continue;
    for (const value of [original, original.slice(0, 64), original.slice(0, 48), original.slice(0, 42)]) {
      if (value) replacements.set(value, labels[key]);
    }
  }
  const compact = (text: string) => {
    if (!replacements.size) return text;
    const pattern = new RegExp([...replacements.keys()].sort((a, b) => b.length - a.length)
      .map(value => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')).join('|'), 'g');
    return text.replace(pattern, value => replacements.get(value)!);
  };
  return { labels, compact };
}
