/**
 * Indonesia payroll calculation with PMK 168/2023 TER (Tarif Efektif Rata-Rata) framework.
 * 
 * TER applies to months 1-11 with direct lookup tables based on PTKP status.
 * December (month 12) uses annualized Pasal 17 calculation with true-up.
 * 
 * Not legal/tax advice — for planning and UI only.
 */

/** PTKP per year (IDR whole), UU PPh / PMK references — rounded common values. */
export const PTKP_ANNUAL_IDR: Record<string, number> = {
  TK0: 54_000_000,
  K0: 58_500_000,
  K1: 63_000_000,
  K2: 67_500_000,
  K3: 72_000_000,
};

export const PTKP_LABELS: Record<string, string> = {
  TK0: "TK/0 — single, no dependants",
  K0: "K/0 — married, no dependants",
  K1: "K/1 — married + 1 dependant",
  K2: "K/2 — married + 2 dependants",
  K3: "K/3 — married + 3 dependants",
};

/** TER Category mapping based on PTKP status */
export function getTERCategory(ptkpCode: string): "A" | "B" | "C" {
  // Category A: TK/0, TK/1, K/0
  if (["TK0", "TK1", "K0"].includes(ptkpCode)) return "A";
  // Category B: TK/2, TK/3, K/1, K/2, K/3
  if (["TK2", "TK3", "K1", "K2", "K3"].includes(ptkpCode)) return "B";
  // Category C: All else (default to A for unknown)
  return "A";
}

/** PMK 168/2023 TER Category A brackets (IDR monthly) */
const TER_CATEGORY_A: Array<{ min: number; max: number; rate: number }> = [
  { min: 0, max: 5_400_000, rate: 0.0000 },
  { min: 5_400_000, max: 5_650_000, rate: 0.0025 },
  { min: 5_650_000, max: 5_950_000, rate: 0.0050 },
  { min: 5_950_000, max: 6_300_000, rate: 0.0075 },
  { min: 6_300_000, max: 6_750_000, rate: 0.0100 },
  { min: 6_750_000, max: 7_500_000, rate: 0.0125 },
  { min: 7_500_000, max: 8_550_000, rate: 0.0150 },
  { min: 8_550_000, max: 9_650_000, rate: 0.0175 },
  { min: 9_650_000, max: 10_050_000, rate: 0.0200 },
  { min: 10_050_000, max: 10_350_000, rate: 0.0225 },
  { min: 10_350_000, max: 10_700_000, rate: 0.0250 },
  { min: 10_700_000, max: 11_050_000, rate: 0.0300 },
  { min: 11_050_000, max: 11_600_000, rate: 0.0350 },
  { min: 11_600_000, max: 12_050_000, rate: 0.0400 },
  { min: 12_050_000, max: 12_950_000, rate: 0.0500 },
  { min: 12_950_000, max: 13_600_000, rate: 0.0600 },
  { min: 13_600_000, max: 14_150_000, rate: 0.0700 },
  { min: 14_150_000, max: 14_750_000, rate: 0.0800 },
  { min: 14_750_000, max: 15_550_000, rate: 0.0900 },
  { min: 15_550_000, max: 16_700_000, rate: 0.1000 },
  { min: 16_700_000, max: 17_950_000, rate: 0.1100 },
  { min: 17_950_000, max: 21_150_000, rate: 0.1200 },
  { min: 21_150_000, max: 25_550_000, rate: 0.1300 },
  { min: 25_550_000, max: 31_600_000, rate: 0.1400 },
  { min: 31_600_000, max: 46_750_000, rate: 0.1500 },
  { min: 46_750_000, max: 78_750_000, rate: 0.1600 },
  { min: 78_750_000, max: 109_750_000, rate: 0.1700 },
  { min: 109_750_000, max: 150_000_000, rate: 0.1800 },
  { min: 150_000_000, max: 214_750_000, rate: 0.1900 },
  { min: 214_750_000, max: 269_750_000, rate: 0.2000 },
  { min: 269_750_000, max: 345_750_000, rate: 0.2100 },
  { min: 345_750_000, max: 453_750_000, rate: 0.2200 },
  { min: 453_750_000, max: 582_750_000, rate: 0.2300 },
  { min: 582_750_000, max: 704_750_000, rate: 0.2400 },
  { min: 704_750_000, max: 957_750_000, rate: 0.2500 },
  { min: 957_750_000, max: 1_404_750_000, rate: 0.2600 },
  { min: 1_404_750_000, max: 1_881_750_000, rate: 0.2700 },
  { min: 1_881_750_000, max: 2_328_750_000, rate: 0.2800 },
  { min: 2_328_750_000, max: 2_988_750_000, rate: 0.2900 },
  { min: 2_988_750_000, max: 4_668_750_000, rate: 0.3000 },
  { min: 4_668_750_000, max: 7_138_750_000, rate: 0.3100 },
  { min: 7_138_750_000, max: 10_368_750_000, rate: 0.3200 },
  { min: 10_368_750_000, max: 14_698_750_000, rate: 0.3300 },
  { min: 14_698_750_000, max: 19_568_750_000, rate: 0.3400 },
  { min: 19_568_750_000, max: 43_008_750_000, rate: 0.3500 },
  { min: 43_008_750_000, max: 999_999_999_999, rate: 0.3600 },
];

/** Default payroll settings */
export const DEFAULT_PAYROLL_SETTINGS = {
  jkkRiskGrade: 0.0024, // Default JKK rate (0.24%)
  jkmRate: 0.003, // JKM rate (0.3%)
  bpjsKesehatanActive: true,
  jpWageCap: 10_042_300, // Updated JP cap
  bpjsKesWageCap: 12_000_000, // BPJS Kesehatan cap
  jhtWageCap: 12_000_000, // JHT cap
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
  // For now, only Category A is fully implemented
  // Categories B and C would have different brackets
  if (terCategory !== "A") {
    // Fallback to approximate calculation for B and C
    const bracket = TER_CATEGORY_A.find((b) => bruto > b.min && bruto <= b.max);
    if (!bracket) {
      // If exceeds Category A brackets, use highest rate
      return Math.floor(bruto * 0.36);
    }
    return Math.floor(bruto * bracket.rate);
  }

  const bracket = TER_CATEGORY_A.find((b) => bruto > b.min && bruto <= b.max);
  if (!bracket) {
    // If exceeds all brackets, use highest rate
    return Math.floor(bruto * 0.36);
  }
  return Math.floor(bruto * bracket.rate);
}

/** Progressive annual PPh on PKP (Pasal 17) for December calculation */
function annualProgressivePPh(pkAnnual: number): number {
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

/** Calculate December true-up using annualized Pasal 17 */
export function calculateDecemberPPh21(
  baseSalary: number,
  settings: Partial<PayrollSettings>,
  cumulativeBrutoJanToNov: number,
  cumulativeTerTaxJanToNov: number,
): { decemberTax: number; annualTax: number } {
  const s = { ...DEFAULT_PAYROLL_SETTINGS, ...settings };
  const ptkpCode = s.ptkpCode ?? "TK0";
  const ptkpAnnual = PTKP_ANNUAL_IDR[ptkpCode] ?? PTKP_ANNUAL_IDR.TK0;

  // Calculate December tax basis
  const decemberBruto = calculateTaxBasisBruto(baseSalary, settings);
  const annualBruto = cumulativeBrutoJanToNov + decemberBruto;

  // Calculate deductions for annual calculation
  const cappedSalaryJht = Math.min(baseSalary, s.jhtWageCap);
  const annualJht = cappedSalaryJht * 0.02 * 12;
  const annualJp = Math.min(baseSalary, s.jpWageCap) * 0.01 * 12;
  const annualBiayaJabatan = Math.min(500_000, Math.round((annualBruto / 12) * 0.05)) * 12;

  const annualDeductions = annualBiayaJabatan + annualJht + annualJp;
  const annualNet = Math.max(0, annualBruto - annualDeductions);
  const pkpAnnual = Math.max(0, annualNet - ptkpAnnual);
  const annualTax = annualProgressivePPh(pkpAnnual);

  // December tax is the difference
  const decemberTax = Math.max(0, annualTax - cumulativeTerTaxJanToNov);

  return { decemberTax, annualTax };
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

  // JHT: 2% of salary up to cap
  const cappedSalaryJht = Math.min(baseSalary, s.jhtWageCap);
  const jhtDeduction = Math.round(cappedSalaryJht * 0.02);

  // JP: 1% of salary up to cap
  const cappedSalaryJp = Math.min(baseSalary, s.jpWageCap);
  const jpDeduction = Math.round(cappedSalaryJp * 0.01);

  // BPJS Kesehatan: 1% of salary up to cap (if active)
  let bpjsKesDeduction = 0;
  if (s.bpjsKesehatanActive) {
    const cappedSalaryKes = Math.min(baseSalary, s.bpjsKesWageCap);
    bpjsKesDeduction = Math.round(cappedSalaryKes * 0.01);
  }

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
  const s: PayrollSettings = {
    ptkpCode,
    terCategory,
    ...DEFAULT_PAYROLL_SETTINGS,
    ...settings,
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
