import { describe, expect, it } from "vitest";

import {
  calculateAnnualPPh21,
  calculateMonthlyPPh21TER,
  estimatePayroll,
  getTERCategory,
  getTERRatePercent,
  jpWageCapFor,
  PTKP_ANNUAL_IDR,
  TER_MONTHLY_TABLES,
} from "./indonesia-payroll";

// Settings that make the tax basis equal the gross salary, so official examples (which have no
// employer premiums) can be reproduced through estimatePayroll.
const NO_EMPLOYER_PREMIUMS = { jkkRiskGrade: 0, jkmRate: 0, bpjsKesehatanActive: false };

describe("TER category mapping (PP 58/2023 Pasal 2 ayat (4))", () => {
  it.each([
    ["TK0", "A"], ["TK1", "A"], ["K0", "A"],
    ["TK2", "B"], ["TK3", "B"], ["K1", "B"], ["K2", "B"],
    ["K3", "C"],
  ])("maps %s to category %s", (code, category) => {
    expect(getTERCategory(code)).toBe(category);
  });
});

describe("monthly TER tables (Lampiran PP 58/2023)", () => {
  it.each([
    ["A", 44, 1_400_000_000],
    ["B", 40, 1_405_000_000],
    ["C", 41, 1_419_000_000],
  ] as const)("category %s has %i ascending rows topping out at 34%% above %i", (category, rows, top) => {
    const table = TER_MONTHLY_TABLES[category];
    expect(table).toHaveLength(rows);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]![0]).toBeGreaterThan(table[i - 1]![0]);
      expect(table[i]![1]).toBeGreaterThan(table[i - 1]![1]);
    }
    expect(table[0]![1]).toBe(0);
    expect(table[table.length - 2]).toEqual([top, 33]);
    expect(getTERRatePercent(top, category)).toBe(33);
    expect(getTERRatePercent(top + 1, category)).toBe(34);
    expect(getTERRatePercent(50_000_000_000, category)).toBe(34);
  });

  it.each([
    // [category, gross, rate%] - row boundaries are "di atas X sampai dengan Y"
    ["A", 5_400_000, 0], ["A", 5_400_001, 0.25], ["A", 12_500_000, 4], ["A", 12_500_001, 5],
    ["A", 15_100_000, 6], ["A", 24_150_001, 10], ["A", 206_000_001, 28],
    ["B", 6_200_000, 0], ["B", 6_200_001, 0.25], ["B", 9_200_001, 1.5], ["B", 21_850_001, 9],
    ["B", 211_000_001, 28],
    ["C", 6_600_000, 0], ["C", 6_600_001, 0.25], ["C", 10_000_000, 1.5], ["C", 11_200_001, 2],
    ["C", 12_050_001, 3], ["C", 221_000_001, 28],
  ] as const)("category %s at Rp%i is %f%%", (category, gross, rate) => {
    expect(getTERRatePercent(gross, category)).toBe(rate);
  });

  it("reproduces PMK 168/2023 example Tuan A (K/0, category A)", () => {
    expect(calculateMonthlyPPh21TER(30_080_000, "A")).toBe(3_910_400); // 13%
    expect(calculateMonthlyPPh21TER(35_080_000, "A")).toBe(4_911_200); // 14%
    expect(calculateMonthlyPPh21TER(50_080_000, "A")).toBe(9_014_400); // 18%
  });

  it("reproduces PMK 168/2023 example Tuan B (TK/0, Rp15,500,000 at 7%)", () => {
    expect(calculateMonthlyPPh21TER(15_500_000, "A")).toBe(1_085_000);
  });

  it("reproduces the Gadjian K/1 category B example monthly withholding", () => {
    expect(calculateMonthlyPPh21TER(8_500_000, "B")).toBe(85_000); // 1%
    expect(calculateMonthlyPPh21TER(12_000_000, "B")).toBe(360_000); // 3%
    expect(calculateMonthlyPPh21TER(17_000_000, "B")).toBe(1_190_000); // 7%
  });

  it("taxes category B and C with their own tables, not table A", () => {
    // Rp11,499,400 tax basis: A = 3.5%, B = 2.5%, C = 2%
    expect(calculateMonthlyPPh21TER(11_499_400, "A")).toBe(402_479);
    expect(calculateMonthlyPPh21TER(11_499_400, "B")).toBe(287_485);
    expect(calculateMonthlyPPh21TER(11_499_400, "C")).toBe(229_988);
  });
});

describe("December reconciliation (Pasal 17 minus Jan-Nov TER)", () => {
  it("reproduces the PP 58/2023 example Tuan R (K/0, Rp10,000,000, iuran pensiun Rp100,000)", () => {
    const monthly = calculateMonthlyPPh21TER(10_000_000, "A");
    expect(monthly).toBe(200_000);
    const annual = calculateAnnualPPh21({
      annualBruto: 120_000_000,
      annualPensionContributions: 1_200_000,
      ptkpAnnual: PTKP_ANNUAL_IDR.K0!,
    });
    expect(annual.pkpAnnual).toBe(54_300_000);
    expect(annual.annualTax).toBe(2_715_000);
    expect(annual.annualTax - monthly * 11).toBe(515_000);
  });

  // DJP simulation table "PP 58 Tahun 2023 dengan ketentuan sebelumnya" (K/0, iuran pensiun Rp100,000/month);
  // negative December figures are refunds.
  it.each([
    [5_500_000, 13_750, 150_000, -1_250],
    [5_750_000, 28_750, 292_500, -23_750],
    [6_000_000, 45_000, 435_000, -60_000],
    [8_000_000, 120_000, 1_575_000, 255_000],
    [10_000_000, 200_000, 2_715_000, 515_000],
  ])("K/0 Rp%i: TER %i, annual %i, December %i", (gross, ter, annualTax, december) => {
    expect(calculateMonthlyPPh21TER(gross, "A")).toBe(ter);
    const annual = calculateAnnualPPh21({
      annualBruto: gross * 12,
      annualPensionContributions: 1_200_000,
      ptkpAnnual: PTKP_ANNUAL_IDR.K0!,
    });
    expect(annual.annualTax).toBe(annualTax);
    expect(annual.annualTax - ter * 11).toBe(december);
  });

  it("reproduces the Gadjian K/1 refund example (Rp50,000 over-withheld)", () => {
    const withheld = 85_000 * 9 + 360_000 + 1_190_000;
    expect(withheld).toBe(2_315_000);
    const annual = calculateAnnualPPh21({
      annualBruto: 114_000_000,
      annualPensionContributions: 0,
      ptkpAnnual: PTKP_ANNUAL_IDR.K1!,
    });
    expect(annual.annualBiayaJabatan).toBe(5_700_000);
    expect(annual.pkpAnnual).toBe(45_300_000);
    expect(annual.annualTax).toBe(2_265_000);
    expect(annual.annualTax - withheld).toBe(-50_000);
  });

  it("reproduces the Pajakku TK/0 Rp8,000,000 example", () => {
    const annual = calculateAnnualPPh21({
      annualBruto: 96_000_000,
      annualPensionContributions: 1_200_000,
      ptkpAnnual: PTKP_ANNUAL_IDR.TK0!,
    });
    expect(annual.annualTax).toBe(1_800_000);
    expect(annual.annualTax - calculateMonthlyPPh21TER(8_000_000, "A") * 11).toBe(480_000);
  });

  it("caps biaya jabatan at Rp6,000,000 and rounds PKP down to thousands", () => {
    const annual = calculateAnnualPPh21({ annualBruto: 200_000_500, annualPensionContributions: 0, ptkpAnnual: 54_000_000 });
    expect(annual.annualBiayaJabatan).toBe(6_000_000);
    expect(annual.pkpAnnual).toBe(140_000_000);
    expect(annual.annualTax).toBe(3_000_000 + 12_000_000);
  });

  it("refunds December over-withholding in net pay", () => {
    // K/0 Rp5,500,000, no employer premiums: JHT 110,000 + JP 55,000 per month are deductible.
    // Annual: 66,000,000 - 3,300,000 - 1,980,000 - 58,500,000 = PKP 2,220,000 -> tax 111,000.
    // Jan-Nov TER: 13,750 x 11 = 151,250, so December is -40,250.
    const dec = estimatePayroll(5_500_000, "K0", 12, NO_EMPLOYER_PREMIUMS);
    expect(dec.calculationMethod).toBe("Pasal17");
    expect(dec.pph21Monthly).toBe(-40_250);
    expect(dec.estimatedNetMonthly).toBe(5_500_000 - 110_000 - 55_000 + 40_250);
    expect(dec.notes.some((n) => n.includes("refunded"))).toBe(true);
  });

  it("charges the December shortfall for a K/1 salary with default premiums", () => {
    // Tax basis 15,561,000 (JKK 0.24%, JKM 0.3%, BPJS Kes 4% of 12M). TER B 6% = 933,660/month.
    // Annual: 186,732,000 - 6,000,000 - (300,000 + 110,863) x 12 - 63,000,000 -> PKP 112,801,000
    // -> tax 3,000,000 + 7,920,150 = 10,920,150; December = 10,920,150 - 933,660 x 11 = 649,890.
    const dec = estimatePayroll(15_000_000, "K1", 12);
    expect(dec.pph21Monthly).toBe(649_890);
    expect(dec.estimatedNetMonthly).toBe(15_000_000 - 649_890 - 300_000 - 110_863 - 120_000);
  });
});

describe("estimatePayroll monthly TER", () => {
  it("uses category B for K/1", () => {
    const result = estimatePayroll(15_000_000, "K1", 1);
    expect(result.terCategory).toBe("B");
    expect(result.taxBasisBruto).toBe(15_561_000);
    expect(result.pph21Monthly).toBe(933_660); // 6%; table A would give 7%
    expect(result.estimatedNetMonthly).toBe(15_000_000 - 933_660 - 300_000 - 110_863 - 120_000);
  });

  it("uses category C for K/3", () => {
    const result = estimatePayroll(11_000_000, "K3", 1);
    expect(result.terCategory).toBe("C");
    expect(result.taxBasisBruto).toBeCloseTo(11_499_400, 6);
    expect(result.pph21Monthly).toBe(229_988); // 2%
  });

  it("ignores a stale stored TER category", () => {
    const result = estimatePayroll(11_000_000, "K3", 1, { terCategory: "B" });
    expect(result.terCategory).toBe("C");
    expect(result.pph21Monthly).toBe(229_988);
  });
});

describe("BPJS employee contributions", () => {
  it("charges JHT 2% on the full salary above Rp12,000,000, even with a stored JHT cap", () => {
    const result = estimatePayroll(20_000_000, "TK0", 1, { jhtWageCap: 12_000_000 });
    expect(result.jhtMonthly).toBe(400_000);
  });

  it("caps JP at the 2026 wage cap by default and honours a stored cap", () => {
    expect(estimatePayroll(20_000_000, "TK0", 1).jpMonthly).toBe(110_863);
    expect(estimatePayroll(20_000_000, "TK0", 1, { jpWageCap: 10_042_300 }).jpMonthly).toBe(100_423);
  });

  it("caps BPJS Kesehatan at Rp12,000,000", () => {
    const result = estimatePayroll(20_000_000, "TK0", 1);
    expect(result.bpjsKesehatanMonthly).toBe(120_000);
    expect(result.employerBpjsKes).toBe(480_000);
  });

  it.each([
    [new Date(2025, 1, 28), 10_042_300],
    [new Date(2025, 2, 1), 10_547_400],
    [new Date(2026, 1, 28), 10_547_400],
    [new Date(2026, 2, 1), 11_086_300],
    [new Date(2026, 11, 25), 11_086_300],
  ])("JP wage cap on %s is %i", (date, cap) => {
    expect(jpWageCapFor(date)).toBe(cap);
  });
});

describe("PTKP", () => {
  it.each([
    ["TK0", 54_000_000], ["TK1", 58_500_000], ["TK2", 63_000_000], ["TK3", 67_500_000],
    ["K0", 58_500_000], ["K1", 63_000_000], ["K2", 67_500_000], ["K3", 72_000_000],
  ])("%s is Rp%i", (code, ptkp) => {
    expect(PTKP_ANNUAL_IDR[code]).toBe(ptkp);
    const result = estimatePayroll(10_000_000, code, 1);
    expect(result.ptkpCode).toBe(code);
    expect(result.ptkpAnnual).toBe(ptkp);
    expect(result.notes.some((n) => n.includes("Unknown PTKP"))).toBe(false);
  });

  it("uses the TK/2 PTKP in the December calculation", () => {
    // TK/2 Rp10,000,000, no employer premiums: JHT 200,000 + JP 100,000 per month.
    // Annual: 120,000,000 - 6,000,000 - 3,600,000 - 63,000,000 = 47,400,000 -> 2,370,000.
    // Jan-Nov TER B 1.5% = 150,000 x 11 = 1,650,000 -> December 720,000.
    const dec = estimatePayroll(10_000_000, "TK2", 12, NO_EMPLOYER_PREMIUMS);
    expect(dec.terCategory).toBe("B");
    expect(dec.pph21Monthly).toBe(720_000);
  });

  it("falls back to TK/0 for unknown codes", () => {
    const result = estimatePayroll(10_000_000, "X9", 1);
    expect(result.ptkpCode).toBe("TK0");
    expect(result.terCategory).toBe("A");
  });
});
