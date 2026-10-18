/**
 * Indonesia payroll calculation with the PP 58/2023 + PMK 168/2023 TER (Tarif Efektif Rata-Rata) framework.
 *
 * TER applies to months 1-11 with direct lookup tables based on PTKP status.
 * December (month 12) uses annualized Pasal 17 calculation with true-up, which can be
 * negative (the employer refunds over-withholding).
 *
 * Not legal/tax advice — for planning and UI only.
 */

/**
 * PTKP per year (IDR whole): Rp54,000,000 for the taxpayer, +Rp4,500,000 if married and
 * +Rp4,500,000 per dependant up to 3 (UU PPh Pasal 7 as amended by UU HPP; PMK 101/2016 amounts).
 */
export const PTKP_ANNUAL_IDR: Record<string, number> = {
  TK0: 54_000_000,
  TK1: 58_500_000,
  TK2: 63_000_000,
  TK3: 67_500_000,
  K0: 58_500_000,
  K1: 63_000_000,
  K2: 67_500_000,
  K3: 72_000_000,
};

export const PTKP_LABELS: Record<string, string> = {
  TK0: "TK/0 — single, no dependants",
  TK1: "TK/1 — single + 1 dependant",
  TK2: "TK/2 — single + 2 dependants",
  TK3: "TK/3 — single + 3 dependants",
  K0: "K/0 — married, no dependants",
  K1: "K/1 — married + 1 dependant",
  K2: "K/2 — married + 2 dependants",
  K3: "K/3 — married + 3 dependants",
};

/** TER category mapping based on PTKP status (PP 58/2023 Pasal 2 ayat (4)). */
export function getTERCategory(ptkpCode: string): "A" | "B" | "C" {
  // Category A: TK/0, TK/1, K/0
  if (["TK0", "TK1", "K0"].includes(ptkpCode)) return "A";
  // Category B: TK/2, TK/3, K/1, K/2
  if (["TK2", "TK3", "K1", "K2"].includes(ptkpCode)) return "B";
  // Category C: K/3
  if (ptkpCode === "K3") return "C";
  // Unknown codes fall back to TK/0 elsewhere, so use its category.
  return "A";
}

/**
 * Monthly TER brackets as [upper bound of monthly gross (inclusive), rate in percent].
 * A row applies when the previous row's bound < gross <= this bound ("di atas ... sampai dengan").
 * Source: Lampiran PP 58/2023 huruf A, B, C (pajak.go.id/sites/default/files/lampiran/Lampiran%20PP58TAHUN2023.pdf).
 */
type TerBracket = readonly [upTo: number, ratePercent: number];

const TER_CATEGORY_A: readonly TerBracket[] = [
  [5_400_000, 0],
  [5_650_000, 0.25],
  [5_950_000, 0.5],
  [6_300_000, 0.75],
  [6_750_000, 1],
  [7_500_000, 1.25],
  [8_550_000, 1.5],
  [9_650_000, 1.75],
  [10_050_000, 2],
  [10_350_000, 2.25],
  [10_700_000, 2.5],
  [11_050_000, 3],
  [11_600_000, 3.5],
  [12_500_000, 4],
  [13_750_000, 5],
  [15_100_000, 6],
  [16_950_000, 7],
  [19_750_000, 8],
  [24_150_000, 9],
  [26_450_000, 10],
  [28_000_000, 11],
  [30_050_000, 12],
  [32_400_000, 13],
  [35_400_000, 14],
  [39_100_000, 15],
  [43_850_000, 16],
  [47_800_000, 17],
  [51_400_000, 18],
  [56_300_000, 19],
  [62_200_000, 20],
  [68_600_000, 21],
  [77_500_000, 22],
  [89_000_000, 23],
  [103_000_000, 24],
  [125_000_000, 25],
  [157_000_000, 26],
  [206_000_000, 27],
  [337_000_000, 28],
  [454_000_000, 29],
  [550_000_000, 30],
  [695_000_000, 31],
  [910_000_000, 32],
  [1_400_000_000, 33],
  [Infinity, 34],
];

const TER_CATEGORY_B: readonly TerBracket[] = [
  [6_200_000, 0],
  [6_500_000, 0.25],
  [6_850_000, 0.5],
  [7_300_000, 0.75],
  [9_200_000, 1],
  [10_750_000, 1.5],
  [11_250_000, 2],
  [11_600_000, 2.5],
  [12_600_000, 3],
  [13_600_000, 4],
  [14_950_000, 5],
  [16_400_000, 6],
  [18_450_000, 7],
  [21_850_000, 8],
  [26_000_000, 9],
  [27_700_000, 10],
  [29_350_000, 11],
  [31_450_000, 12],
  [33_950_000, 13],
  [37_100_000, 14],
  [41_100_000, 15],
  [45_800_000, 16],
  [49_500_000, 17],
  [53_800_000, 18],
  [58_500_000, 19],
  [64_000_000, 20],
  [71_000_000, 21],
  [80_000_000, 22],
  [93_000_000, 23],
  [109_000_000, 24],
  [129_000_000, 25],
  [163_000_000, 26],
  [211_000_000, 27],
  [374_000_000, 28],
  [459_000_000, 29],
  [555_000_000, 30],
  [704_000_000, 31],
  [957_000_000, 32],
  [1_405_000_000, 33],
  [Infinity, 34],
];

const TER_CATEGORY_C: readonly TerBracket[] = [
  [6_600_000, 0],
  [6_950_000, 0.25],
  [7_350_000, 0.5],
  [7_800_000, 0.75],
  [8_850_000, 1],
  [9_800_000, 1.25],
  [10_950_000, 1.5],
  [11_200_000, 1.75],
  [12_050_000, 2],
  [12_950_000, 3],
  [14_150_000, 4],
  [15_550_000, 5],
  [17_050_000, 6],
  [19_500_000, 7],
  [22_700_000, 8],
  [26_600_000, 9],
  [28_100_000, 10],
  [30_100_000, 11],
  [32_600_000, 12],
  [35_400_000, 13],
  [38_900_000, 14],
  [43_000_000, 15],
  [47_400_000, 16],
  [51_200_000, 17],
  [55_800_000, 18],
  [60_400_000, 19],
  [66_700_000, 20],
  [74_500_000, 21],
  [83_200_000, 22],
  [95_600_000, 23],
  [110_000_000, 24],
  [134_000_000, 25],
  [169_000_000, 26],
  [221_000_000, 27],
  [390_000_000, 28],
  [463_000_000, 29],
  [561_000_000, 30],
  [709_000_000, 31],
  [965_000_000, 32],
  [1_419_000_000, 33],
  [Infinity, 34],
];

export const TER_MONTHLY_TABLES: Record<"A" | "B" | "C", readonly TerBracket[]> = {
  A: TER_CATEGORY_A,
  B: TER_CATEGORY_B,
  C: TER_CATEGORY_C,
};

/** Monthly TER rate in percent for a gross amount (PP 58/2023 Lampiran A-C). */
export function getTERRatePercent(bruto: number, terCategory: "A" | "B" | "C" = "A"): number {
  const table = TER_MONTHLY_TABLES[terCategory] ?? TER_CATEGORY_A;
  const bracket = table.find(([upTo]) => bruto <= upTo) ?? table[table.length - 1]!;
  return bracket[1];
}

/**
 * Jaminan Pensiun wage cap (upah tertinggi), adjusted every 1 March by prior-year GDP growth
 * (PP 45/2015 Pasal 29). Values from the BPJS Ketenagakerjaan circulars for each year.
 */
export const JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE: ReadonlyArray<{ effectiveFrom: string; cap: number }> = [
  { effectiveFrom: "2024-03-01", cap: 10_042_300 },
  { effectiveFrom: "2025-03-01", cap: 10_547_400 },
  // BPJS Ketenagakerjaan circular B/1226/022026 (25 Feb 2026): 10,547,400 x 1.0511, rounded down.
  { effectiveFrom: "2026-03-01", cap: 11_086_300 },
];

/** JP wage cap in force on a date (YYYY-MM-DD comparison); the earliest known cap before the table starts. */
/**
 * The JP cap to use for a saved setting. A saved value that equals one of the official yearly caps
 * was a default, not a user choice, so it follows the cap in force on `date`; anything else is kept.
 */
export function effectiveJpWageCap(savedCap: number | null | undefined, date: Date): number {
  if (savedCap == null || savedCap <= 0 || JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE.some((entry) => entry.cap === savedCap)) return jpWageCapFor(date);
  return savedCap;
}

export function jpWageCapFor(date: Date): number {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let cap = JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE[0]!.cap;
  for (const entry of JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE) {
    if (entry.effectiveFrom <= iso) cap = entry.cap;
  }
  return cap;
}

/** BPJS Kesehatan PPU wage cap: Perpres 82/2018 Pasal 32(1) as amended by Perpres 75/2019 (unchanged by Perpres 64/2020, 59/2024). */
export const BPJS_KESEHATAN_WAGE_CAP_IDR = 12_000_000;

/** Biaya jabatan: 5% of gross, max Rp500,000/month = Rp6,000,000/year (PMK 168/2023). */
const BIAYA_JABATAN_RATE = 0.05;
const BIAYA_JABATAN_ANNUAL_MAX = 6_000_000;

/** Default payroll settings */
export const DEFAULT_PAYROLL_SETTINGS = {
  jkkRiskGrade: 0.0024, // Default JKK rate (0.24%)
  jkmRate: 0.003, // JKM rate (0.3%)
  bpjsKesehatanActive: true,
  jpWageCap: JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE[JP_WAGE_CAP_IDR_BY_EFFECTIVE_DATE.length - 1]!.cap, // 2026 JP cap
  bpjsKesWageCap: BPJS_KESEHATAN_WAGE_CAP_IDR,
  /** @deprecated JHT has no wage cap; kept only for stored-settings compatibility and ignored. */
  jhtWageCap: 0,
};

/** Payroll settings interface */
export interface PayrollSettings {
  ptkpCode: string;
  terCategory: "A" | "B" | "C";
  jkkRiskGrade: number;
  jkmRate: number;
  bpjsKesehatanActive: boolean;
  jpWageCap: number;
  bpjsKesWageCap: number;
  /** @deprecated JHT (2% employee) has no wage cap; this value is ignored. */
  jhtWageCap: number;
}

/** Calculate tax basis (Penghasilan Bruto) including employer-paid premiums */
export function calculateTaxBasisBruto(
  baseSalary: number,
  settings: Partial<PayrollSettings>,
): number {
  const s = { ...DEFAULT_PAYROLL_SETTINGS, ...settings };
  
  // Employer-paid JKK and JKM are taxable income components
  const employerJkk = baseSalary * s.jkkRiskGrade;
  const employerJkm = baseSalary * s.jkmRate;
  
  // Employer BPJS Kesehatan (4%) if active
  let employerBpjsKes = 0;
  if (s.bpjsKesehatanActive) {
    const cappedSalaryKes = Math.min(baseSalary, s.bpjsKesWageCap);
    employerBpjsKes = cappedSalaryKes * 0.04;
  }

  return baseSalary + employerJkk + employerJkm + employerBpjsKes;
}

/** Calculate monthly PPh 21 using TER for months 1-11 */
export function calculateMonthlyPPh21TER(
  bruto: number,
  terCategory: "A" | "B" | "C" = "A",
): number {
  if (bruto <= 0) return 0;
  return Math.floor((bruto * getTERRatePercent(bruto, terCategory)) / 100);
}

/** Progressive annual PPh on PKP (Pasal 17 ayat (1) huruf a, as amended by UU HPP) for December calculation */
export function annualProgressivePPh(pkAnnual: number): number {
  if (pkAnnual <= 0) return 0;
  let tax = 0;
  let rem = pkAnnual;

  const slice = (cap: number, rate: number) => {
    const part = Math.min(rem, cap);
    tax += part * rate;
    rem -= part;
  };

  slice(60_000_000, 0.05);
  if (rem <= 0) return Math.round(tax);
  slice(190_000_000, 0.15);
  if (rem <= 0) return Math.round(tax);
  slice(250_000_000, 0.25);
  if (rem <= 0) return Math.round(tax);
  slice(4_500_000_000, 0.3);
  tax += rem * 0.35;
  return Math.round(tax);
}

/**
 * Annual PPh 21 for the last tax period (PMK 168/2023):
 * (annual gross - biaya jabatan - employee pension/JHT contributions - PTKP), with PKP rounded
 * down to whole thousands (UU PPh Pasal 17 ayat (4)), taxed at Pasal 17 rates.
 */
export function calculateAnnualPPh21(input: {
  annualBruto: number;
  /** Employee-paid JHT + JP (iuran pensiun / hari tua) for the year */
  annualPensionContributions: number;
  ptkpAnnual: number;
}): { annualBiayaJabatan: number; annualNet: number; pkpAnnual: number; annualTax: number } {
  const annualBiayaJabatan = Math.min(BIAYA_JABATAN_ANNUAL_MAX, Math.floor(input.annualBruto * BIAYA_JABATAN_RATE));
  const annualNet = Math.max(0, input.annualBruto - annualBiayaJabatan - input.annualPensionContributions);
  const pkpAnnual = Math.floor(Math.max(0, annualNet - input.ptkpAnnual) / 1000) * 1000;
  return { annualBiayaJabatan, annualNet, pkpAnnual, annualTax: annualProgressivePPh(pkpAnnual) };
}

/**
 * Calculate December true-up using annualized Pasal 17.
 * decemberTax = annual tax - Jan-Nov TER withholding, and is negative when TER over-withheld
 * (the employer refunds the excess in December).
 */
export function calculateDecemberPPh21(
  baseSalary: number,
  settings: Partial<PayrollSettings>,
  cumulativeBrutoJanToNov: number,
  cumulativeTerTaxJanToNov: number,
): { decemberTax: number; annualTax: number } {
  const ptkpCode = settings.ptkpCode ?? "TK0";
  const ptkpAnnual = PTKP_ANNUAL_IDR[ptkpCode] ?? PTKP_ANNUAL_IDR.TK0!;

  // Calculate December tax basis
  const decemberBruto = calculateTaxBasisBruto(baseSalary, settings);
  const annualBruto = cumulativeBrutoJanToNov + decemberBruto;

  // Employee JHT + JP for the year (assumes the same salary every month)
  const { jhtDeduction, jpDeduction } = calculateEmployeeDeductions(baseSalary, 0, settings);
  const { annualTax } = calculateAnnualPPh21({
    annualBruto,
    annualPensionContributions: (jhtDeduction + jpDeduction) * 12,
    ptkpAnnual,
  });

  return { decemberTax: annualTax - cumulativeTerTaxJanToNov, annualTax };
}

/** Calculate employee deductions respecting opt-outs and wage caps */
export function calculateEmployeeDeductions(
  baseSalary: number,
  monthlyTax: number,
  settings: Partial<PayrollSettings>,
): {
  jhtDeduction: number;
  jpDeduction: number;
  bpjsKesDeduction: number;
  totalDeductions: number;
  netPay: number;
} {
  const s = { ...DEFAULT_PAYROLL_SETTINGS, ...settings };

  // JHT: 2% of the full salary. JHT has no wage cap (PP 46/2015), so s.jhtWageCap is ignored.
  const jhtDeduction = Math.round(baseSalary * 0.02);

  // JP: 1% of salary up to cap
  const cappedSalaryJp = Math.min(baseSalary, s.jpWageCap);
  const jpDeduction = Math.round(cappedSalaryJp * 0.01);

  // BPJS Kesehatan: 1% of salary up to cap (if active)
  let bpjsKesDeduction = 0;
  if (s.bpjsKesehatanActive) {
    const cappedSalaryKes = Math.min(baseSalary, s.bpjsKesWageCap);
    bpjsKesDeduction = Math.round(cappedSalaryKes * 0.01);
  }

  // monthlyTax is negative for a December refund, which raises take-home pay.
  const totalDeductions = monthlyTax + jhtDeduction + jpDeduction + bpjsKesDeduction;
  const netPay = Math.max(0, baseSalary - totalDeductions);

  return {
    jhtDeduction,
    jpDeduction,
    bpjsKesDeduction,
    totalDeductions,
    netPay,
  };
}

export type PayrollBreakdown = {
  grossMonthly: number;
  ptkpCode: string;
  ptkpAnnual: number;
  terCategory: "A" | "B" | "C";
  /** Tax basis (Bruto) including employer premiums */
  taxBasisBruto: number;
  /** Employer-paid JKK */
  employerJkk: number;
  /** Employer-paid JKM */
  employerJkm: number;
  /** Employer-paid BPJS Kesehatan (4%) */
  employerBpjsKes: number;
  /** Employee JHT deduction (2%) */
  jhtMonthly: number;
  /** Employee JP deduction (1%) */
  jpMonthly: number;
  /** Employee BPJS Kesehatan deduction (1%) */
  bpjsKesehatanMonthly: number;
  /** Monthly PPh 21 (TER for months 1-11, true-up for Dec) */
  pph21Monthly: number;
  /** Total mandatory deductions from employee */
  totalMandatoryDeductionsMonthly: number;
  /** Estimated net take-home pay */
  estimatedNetMonthly: number;
  /** Method used: 'TER' for months 1-11, 'Pasal17' for December */
  calculationMethod: "TER" | "Pasal17";
  notes: string[];
};

/**
 * Calculate payroll using PMK 168/2023 TER framework.
 * 
 * @param grossMonthlyIdr - Base gross monthly salary
 * @param ptkpCode - PTKP status code (TK0, K0, K1, etc.)
 * @param month - Month number (1-12), defaults to current behavior (month 1-11)
 * @param settings - Optional payroll settings for custom configurations
 */
export function estimatePayroll(
  grossMonthlyIdr: number,
  ptkpCode: string,
  month: number = 1,
  settings: Partial<PayrollSettings> = {},
): PayrollBreakdown {
  const notes: string[] = [
    `Using PMK 168/2023 TER framework for month ${month}. Employer-paid premiums (JKK, JKM${settings.bpjsKesehatanActive !== false ? ", BPJS Kes" : ""}) included in tax basis.`,
  ];

  const gross = Math.max(0, Math.floor(grossMonthlyIdr));
  const ptkpAnnual = PTKP_ANNUAL_IDR[ptkpCode] ?? PTKP_ANNUAL_IDR.TK0;
  const terCategory = getTERCategory(ptkpCode);
  
  if (!PTKP_ANNUAL_IDR[ptkpCode]) {
    notes.push(`Unknown PTKP code "${ptkpCode}", using TK/0.`);
  }

  // Merge with defaults
  // The TER category is fixed by the PTKP status (PP 58/2023), so a stored category cannot override it.
  const s: PayrollSettings = {
    ...DEFAULT_PAYROLL_SETTINGS,
    ...settings,
    ptkpCode,
    terCategory,
  };

  if (gross === 0) {
    return {
      grossMonthly: 0,
      ptkpCode: PTKP_ANNUAL_IDR[ptkpCode] ? ptkpCode : "TK0",
      ptkpAnnual,
      terCategory,
      taxBasisBruto: 0,
      employerJkk: 0,
      employerJkm: 0,
      employerBpjsKes: 0,
      jhtMonthly: 0,
      jpMonthly: 0,
      bpjsKesehatanMonthly: 0,
      pph21Monthly: 0,
      totalMandatoryDeductionsMonthly: 0,
      estimatedNetMonthly: 0,
      calculationMethod: "TER",
      notes,
    };
  }

  // Calculate tax basis (Bruto) with employer-paid premiums
  const taxBasisBruto = calculateTaxBasisBruto(gross, s);
  const employerJkk = gross * s.jkkRiskGrade;
  const employerJkm = gross * s.jkmRate;
  const employerBpjsKes = s.bpjsKesehatanActive
    ? Math.min(gross, s.bpjsKesWageCap) * 0.04
    : 0;

  // Calculate employee deductions
  const deductions = calculateEmployeeDeductions(gross, 0, s);

  // Calculate PPh 21 based on month
  let pph21Monthly: number;
  let calculationMethod: "TER" | "Pasal17";

  if (month === 12) {
    // December: Use annualized Pasal 17 with true-up
    // For preview purposes, we calculate as if Jan-Nov were standard
    const cumulativeBruto = taxBasisBruto * 11; // Assume 11 months same salary
    const cumulativeTerTax = calculateMonthlyPPh21TER(taxBasisBruto, terCategory) * 11;
    const decemberResult = calculateDecemberPPh21(gross, s, cumulativeBruto, cumulativeTerTax);
    pph21Monthly = decemberResult.decemberTax;
    calculationMethod = "Pasal17";
    notes.push("December calculation uses annualized Pasal 17 with true-up against Jan-Nov TER withholdings.");
    if (pph21Monthly < 0) {
      notes.push("Jan-Nov TER withholding exceeded the annual tax; the excess is refunded in December pay.");
    }
  } else {
    // Months 1-11: Use TER
    pph21Monthly = calculateMonthlyPPh21TER(taxBasisBruto, terCategory);
    calculationMethod = "TER";
  }

  // Recalculate with actual tax
  const finalDeductions = calculateEmployeeDeductions(gross, pph21Monthly, s);

  return {
    grossMonthly: gross,
    ptkpCode: PTKP_ANNUAL_IDR[ptkpCode] ? ptkpCode : "TK0",
    ptkpAnnual,
    terCategory,
    taxBasisBruto,
    employerJkk: Math.round(employerJkk),
    employerJkm: Math.round(employerJkm),
    employerBpjsKes: Math.round(employerBpjsKes),
    jhtMonthly: finalDeductions.jhtDeduction,
    jpMonthly: finalDeductions.jpDeduction,
    bpjsKesehatanMonthly: finalDeductions.bpjsKesDeduction,
    pph21Monthly,
    totalMandatoryDeductionsMonthly: finalDeductions.totalDeductions,
    estimatedNetMonthly: finalDeductions.netPay,
    calculationMethod,
    notes,
  };
}

/** Legacy export for backward compatibility */
export { estimatePayroll as calculatePayroll };
