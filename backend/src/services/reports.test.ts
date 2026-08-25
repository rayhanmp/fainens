import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));

let exportReportToCSV: typeof import("./reports").exportReportToCSV;

beforeAll(async () => {
  ({ exportReportToCSV } = await import("./reports"));
});

describe("exportReportToCSV", () => {
  it("exports cash-flow statements instead of returning an empty file", () => {
    const csv = exportReportToCSV({
      operating: [{ category: "Operating", description: "Salary, net", amount: 10_000, type: "operating" }],
      investing: [],
      financing: [],
      netOperating: 10_000,
      netInvesting: 0,
      netFinancing: 0,
      netChange: 10_000,
      beginningCash: 5_000,
      endingCash: 15_000,
      periodName: "April",
    });

    expect(csv).toContain('"CASH FLOW STATEMENT"');
    expect(csv).toContain('"Salary, net","Operating","10000"');
    expect(csv).toContain('"ENDING CASH","15000"');
  });

  it("quotes CSV fields and neutralizes untrusted spreadsheet formulas", () => {
    const csv = exportReportToCSV({
      revenue: [{ name: '=HYPERLINK("https://invalid")', amount: 1_000, level: 0 }],
      expenses: [{ name: "Food, drinks\nand snacks", amount: -250, level: 0 }],
      totalRevenue: 1_000,
      totalExpenses: -250,
      netIncome: 1_250,
      periodName: "Test",
    });

    expect(csv).toContain('"\'=HYPERLINK(""https://invalid"")","1000"');
    expect(csv).toContain('"Food, drinks\nand snacks","-250"');
    expect(csv).toContain('"TOTAL EXPENSES","-250"');
  });
});
