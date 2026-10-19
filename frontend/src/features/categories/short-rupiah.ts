/** Short rupiah for tight spots in charts: Rp6,7 jt, Rp850 rb, Rp1,2 M. */
export function shortRupiah(value: number): string {
  const sign = value < 0 ? '−' : '';
  const size = Math.abs(value);
  const units: [number, string][] = [[1e9, 'M'], [1e6, 'jt'], [1e3, 'rb']];
  for (const [unit, label] of units) {
    if (size >= unit) return `${sign}Rp${(size / unit).toLocaleString('id-ID', { maximumFractionDigits: size / unit >= 100 ? 0 : 1 })} ${label}`;
  }
  return `${sign}Rp${size.toLocaleString('id-ID')}`;
}
