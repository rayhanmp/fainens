import type { SavedRecapStory } from './recap-schemas';
import { shortRecapLabel } from './recap-labels';

export function recapDetailInsights(snapshot: SavedRecapStory['snapshot'], labels: Record<string, string>, language: 'en' | 'id' = 'en') {
  const id = language === 'id';
  const repeat = snapshot.highlights?.repeatPurchases?.[0];
  const profile = snapshot.purchaseProfile;
  const average = profile && snapshot.purchaseCount > 0 ? profile.totalAmount / snapshot.purchaseCount : null;
  const median = profile?.medianAmount;
  const share = profile && snapshot.largestPurchase ? Math.min(100, Math.round(snapshot.largestPurchase.amount / profile.totalAmount * 100)) : null;
  const repeatShare = repeat && snapshot.purchaseCount > 0 ? Math.round(repeat.occurrences / snapshot.purchaseCount * 100) : null;
  const baseline = snapshot.coverageComplete ? snapshot.baseline : null;
  const priorAverage = baseline?.purchaseTotal !== undefined && baseline.purchaseTotal > 0 && baseline.purchaseCount > 0
    ? baseline.purchaseTotal / baseline.purchaseCount : null;
  const averageChange = average !== null && priorAverage !== null ? Math.round((average - priorAverage) / priorAverage * 100) : null;
  const comparisonScope = baseline?.periodCount === 1
    ? id ? 'vs satu period lengkap sebelumnya' : 'vs a prior complete period'
    : id ? `vs gabungan ${baseline?.periodCount} period sebelumnya` : `vs purchases across ${baseline?.periodCount} prior periods`;
  const timing = baseline?.matchedElapsed ? id ? ' pada titik yang sama' : ' at the same point' : '';
  return {
    purchases: {
      title: repeat ? id ? 'Ada nama yang bolak-balik muncul.' : 'One name kept coming back.' : id ? 'Struknya tidak punya pemeran tetap.' : 'No recurring receipt this time.',
      body: repeat && repeatShare !== null
        ? id ? `${labels.repeatPurchase1} muncul ${repeat.occurrences} kali, setara ${repeatShare}% pembelianmu.`
          : `${labels.repeatPurchase1} appeared ${repeat.occurrences} times, accounting for ${repeatShare}% of your purchases.`
        : id ? 'Tidak ada deskripsi pembelian yang berulang di catatan ini.' : 'No named purchase repeated in these entries.',
    },
    moment: {
      title: share !== null && share >= 25 ? id ? 'Satu struk mengambil porsi besar.' : 'One receipt took a sizeable slice.' : id ? 'Struk terbesar, bagian dari keseluruhan.' : 'The biggest receipt, in perspective.',
      body: share !== null ? id ? `${labels.standoutPurchase} mengambil ${share}% dari total nominal pembelian${snapshot.isPartial ? ' sejauh ini' : ''}.`
        : `${labels.standoutPurchase} made up ${share}% of purchase spend${snapshot.isPartial ? ' so far' : ''}.`
        : id ? `${labels.standoutPurchase ?? 'Item ini'} adalah pembelian terbesar di catatan period ini.` : `${labels.standoutPurchase ?? 'This item'} was this period’s largest recorded purchase.`,
    },
    balance: {
      title: average !== null && median && average >= median * 1.25
        ? id ? 'Struk besar bukan seluruh ceritanya.' : 'The big receipts weren’t the whole story.'
        : id ? 'Seperti apa struk yang di tengah?' : 'What did a middle-sized receipt look like?',
      body: average !== null && median
        ? average >= median * 1.25
          ? id ? `Rata-rata struk ${Math.round(average / median * 10) / 10}× nominal tengahnya. Pembelian besar menarik rata-rata ke atas.`
            : `The average receipt was ${Math.round(average / median * 10) / 10}× the middle amount. Bigger purchases pulled the average up.`
          : id ? `Rata-rata struk ${Math.abs(Math.round((average - median) / median * 100))}% ${average >= median ? 'di atas' : 'di bawah'} nominal tengahnya.`
            : `The average receipt was ${Math.abs(Math.round((average - median) / median * 100))}% ${average >= median ? 'above' : 'below'} the middle amount.`
        : id ? 'Belum ada nominal pembelian yang bisa dipakai untuk melihat pola ini.' : 'There are no purchase amounts available for this pattern yet.',
    },
    comparison: averageChange !== null
      ? {
        title: averageChange >= 10 ? id ? 'Rata-rata struknya ikut membesar.' : 'The average receipt got bigger.'
          : averageChange <= -10 ? id ? 'Rata-rata struknya lebih kecil.' : 'The average receipt got smaller.'
            : id ? 'Rata-rata struknya masih familiar.' : 'A familiar average receipt size.',
        body: id ? `Rata-rata nominal per pembelian ${averageChange === 0 ? 'hampir sama' : `${Math.abs(averageChange)}% ${averageChange > 0 ? 'lebih besar' : 'lebih kecil'}`} ${comparisonScope}${timing}.`
          : `Average purchase size was ${averageChange === 0 ? 'about the same' : `${Math.abs(averageChange)}% ${averageChange > 0 ? 'higher' : 'lower'}`} ${comparisonScope}${timing}.`,
      }
      : snapshot.comparison ? {
        title: snapshot.comparison.changePercent > 0 ? id ? 'Total pengeluaran naik kali ini.' : 'The expense total climbed this time.'
          : snapshot.comparison.changePercent < 0 ? id ? 'Total pengeluaran turun kali ini.' : 'The expense total came down.'
            : id ? 'Total pengeluarannya tetap sama.' : 'The expense total stayed level.',
        body: id ? `Pengeluaran tercatat ${Math.abs(Math.round(snapshot.comparison.changePercent))}% ${snapshot.comparison.changePercent >= 0 ? 'lebih tinggi' : 'lebih rendah'} dibanding ${shortRecapLabel(snapshot.comparison.periodName, 42)}.`
          : `Recorded expenses were ${Math.abs(Math.round(snapshot.comparison.changePercent))}% ${snapshot.comparison.changePercent >= 0 ? 'higher' : 'lower'} than ${shortRecapLabel(snapshot.comparison.periodName, 42)}.`,
      } : null,
    averageChange,
  };
}
