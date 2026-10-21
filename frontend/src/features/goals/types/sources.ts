/** Where the facts each kind of goal shows come from, so every one of them links to its source. */
export const SOURCES = {
  /** OJK's advice of at least three months, as Pegadaian reports it, with 3–6 months for one person. */
  emergencyOjk: { label: 'Pegadaian, citing OJK', url: 'https://pegadaian.co.id/artikel/keuangan/ketahui-berapa-dana-darurat-yang-wajib-kamu-punya' },
  /** Larger amounts with a family relying on you. */
  emergencyFamily: { label: 'Investasiku', url: 'https://www.investasiku.id/eduvest/keuangan/berapa-dana-darurat-yang-ideal' },
  /** Banks usually keep a KPR payment within about 30% of take-home pay. */
  kprLimit: { label: 'Rumah123', url: 'https://www.rumah123.com/kpr/kemampuan-kpr/' },
  /** Bank Indonesia lets qualifying banks lend up to the whole price (LTV 100%) until the end of 2026. */
  ltv: { label: 'Bank Indonesia, PADG 30/2025', url: 'https://www.bi.go.id/id/publikasi/peraturan/Pages/PADG_302025.aspx' },
  /** BPHTB at most 5%, above an untaxed amount of at least Rp80 juta for a first home (UU 1/2022). */
  bphtb: { label: 'DDTC on UU 1/2022', url: 'https://news.ddtc.co.id/berita/nasional/35545/uu-hkpd-revisi-aturan-npoptkp-tanah-danatau-bangunan-ini-rinciannya' },
  /** Kemenag's reference price for an umrah package, Rp23 juta (KMA 1021/2023). */
  umrahReference: { label: 'Tirto, on KMA 1021/2023', url: 'https://tirto.id/biaya-umroh-ramadhan-2025-itikaf-10-hari-terakhir-g86Z' },
  /** Packages below the reference must be reported to Kemenag. */
  umrahReport: { label: 'Setkab', url: 'https://setkab.go.id/biaya-referensi-umrah-rp20-juta-kemenag-jika-ada-yang-pasang-harga-lebih-rendah-harus-lapor/' },
  /** STNK and plate last five years, stamped every year with the tax (UU 22/2009, Pasal 70). */
  stnk: { label: 'detikOto, on UU 22/2009', url: 'https://oto.detik.com/berita/d-7979105/kenapa-sih-stnk-tak-berlaku-selamanya-dan-harus-diperpanjang' },
  /** THR at the latest seven days before the holiday (Permenaker 6/2016). */
  thr: { label: 'Setkab, on Permenaker 6/2016', url: 'https://setkab.go.id/menaker-thr-bagi-pekerja-wajib-diberikan-maksimal-h-7-lebaran/' },
} as const;

export type SourceKey = keyof typeof SOURCES;
